import { MODULE_ID } from "../constants";
import { resolveUuidSync } from "../utils/resolve-uuid";
import { stationRoller } from "./membership";
import { resolveRoller, type RollerOption, type RollerResolution } from "./roller";

/**
 * The Foundry-bound edge of the Roller half of **station-actions** (#25): it reads the pin, calls
 * the pure `resolveRoller` in `./roller.ts` - the actual seam, which sees plain data only - asks
 * the question when there is one, and runs the action as whoever came back.
 *
 * Per docs/adr/0003 the Roller is the identity of the action's *parent Actor* and nothing else:
 *
 * - `ship`: the ship's own owned Item already has the right parent chain, so this is
 *   `item.use(event)` and nothing more - untouched system behavior, including daggerheart's own
 *   `ActionSelectionDialog` for a multi-action feature.
 * - a crew member: the chosen action is re-instantiated against that character's `system`
 *   (`new cls(action.toObject(), { parent: character.system })`), following the precedent
 *   daggerheart sets for its own rest moves (`actionUseButton`). Its trait, its experiences in the
 *   roll dialog and its Hope/Stress all follow `action.actor`, which is now the character.
 *
 * The roller question comes *first* and the system's action-selection dialog second (#21's user
 * story 10), which is why the crew path picks the action here rather than going through
 * `DHItem#use`: that method asks "which action?" and then uses it against its own parent, with no
 * seam between the two.
 */

/** The parts of the pressed Station action (a `feature` Item owned by the Spaceship) this uses. */
interface LooseStationAction {
  name: string;
  flags?: Readonly<Record<string, unknown>>;
  system: { actionsList?: Iterable<LooseActionDocument> };
  /** `DHItem#use` - the whole of the `ship` branch, and nothing this module reimplements. */
  use(event: PointerEvent): Promise<unknown>;
}

/**
 * The parts of one of daggerheart's Action pseudo-documents this file touches. `toObject` and
 * `update` are the DataModel/Action-level API (not sheet code); `type` names the class to
 * re-instantiate through the system's own action registry.
 */
interface LooseActionDocument {
  type: string;
  toObject(): Record<string, unknown>;
  update(updates: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  use(event: PointerEvent): Promise<unknown>;
}

/** The parts of an Actor a re-parented action is used against. */
interface LooseRollActor {
  system: object;
}

/**
 * What the prompt needs of the Spaceship to offer it as an option: its name, which is what the
 * ship's button reads. No portrait - `DialogV2` buttons take a Font Awesome icon, not an image.
 */
export interface ShipOption {
  name: string;
}

/**
 * The resolutions that actually run something - a prompt has already been answered away. Derived
 * from `RollerResolution` rather than spelled again, so a fourth outcome added to the seam cannot
 * quietly bypass this file.
 */
type ResolvedRoller = Exclude<RollerResolution, { kind: "prompt" }>;

/** Minimal shape of the `game.system.api` corners this file reaches through. */
interface DaggerheartSystem {
  api?: {
    applications?: {
      dialogs?: {
        ActionSelectionDialog?: {
          create(item: unknown, event: PointerEvent): Promise<LooseActionDocument | null>;
        };
      };
    };
    models?: {
      actions?: {
        actionsTypes?: Record<
          string,
          new (data: Record<string, unknown>, context: { parent: object }) => LooseActionDocument
        >;
      };
    };
  };
}

function daggerheartApi(): DaggerheartSystem["api"] {
  return (game.system as unknown as DaggerheartSystem)?.api;
}

/**
 * Press one Station action: work out who acts, ask if the answer isn't already known, and run it.
 *
 * `crew` is the pressed Station's own crew, in ship order - only that Station's, never the union
 * over the ship (#25: "the crew prompt lists only that Station's crew").
 *
 * Every way this can decline to run is a notification and a return, never a throw: a Station with
 * no crew behind a `crew` action, a crew UUID that no longer resolves, an unanswered prompt and a
 * feature carrying no actions at all all leave the sheet exactly as it was.
 */
export async function pressStationAction(
  item: LooseStationAction,
  ship: ShipOption,
  crew: readonly string[],
  event: PointerEvent,
): Promise<void> {
  const resolution = resolveRoller(stationRoller(item), crew, game.user?.character?.uuid ?? null);

  const resolved = await answerRoller(resolution, item, ship);
  if (!resolved) return;

  if (resolved.kind === "ship") {
    // docs/adr/0003's `ship` branch: the item's parent chain already ends at the Spaceship, so
    // this is daggerheart's own `DHItem#use` doing all of it - single action or selection dialog.
    await item.use(event);
    return;
  }

  // `fromUuid`, not the `resolveUuidSync` the prompt labelled its options with: that one settles
  // for a compendium *index* record (a name and a portrait, no `system`), and an action can only
  // be re-parented to a real document.
  const actor = (await fromUuid(resolved.uuid)) as LooseRollActor | null;
  if (!actor) {
    ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.StationActions.unknownRoller"));
    return;
  }

  await useAsActor(item, actor, event);
}

/**
 * Turn a `RollerResolution` into the one thing that can be run, asking the user if that is what it
 * says to do. `null` means "nothing to run" - an empty prompt, or one the user dismissed.
 */
async function answerRoller(
  resolution: RollerResolution,
  item: LooseStationAction,
  ship: ShipOption,
): Promise<ResolvedRoller | null> {
  if (resolution.kind !== "prompt") return resolution;

  const choices = resolution.options.flatMap((option) => describeOption(option, ship) ?? []);
  if (choices.length === 0) {
    // `resolveRoller` only ever returns an empty (or all-unresolvable) prompt for a `crew` action
    // at a Station with nobody to roll it - `ask` always carries the ship.
    ui.notifications?.warn(game.i18n!.localize("DHSCIFI.Spaceship.StationActions.noRoller"));
    return null;
  }

  return promptRoller(item, choices);
}

/** One prompt option, resolved for display: what it runs as, and how the button reads. */
interface RollerChoice {
  resolved: ResolvedRoller;
  label: string;
  icon: string;
}

/**
 * Resolve one option to a button, or to `undefined` for a crew UUID that no longer names anything.
 *
 * Dropping an unresolvable crew member rather than offering an "Unknown" button is the graceful
 * half of the same rule the Stations tab's crew strip follows: a crew assignment is a one-way
 * reference that is never synced (CONTEXT.md), so the tab still *shows* the dangling entry, but
 * there is nothing to roll as, and a button that can only fail is worse than one less button.
 */
function describeOption(option: RollerOption, ship: ShipOption): RollerChoice | undefined {
  if (option.kind === "ship") {
    return { resolved: { kind: "ship" }, label: ship.name, icon: "fa-solid fa-rocket" };
  }

  const actor = resolveUuidSync<{ name?: string | null }>(option.uuid);
  if (!actor?.name) return undefined;

  return { resolved: { kind: "actor", uuid: option.uuid }, label: actor.name, icon: "fa-solid fa-user" };
}

/**
 * Ask who acts, one button per choice. `null` when the dialog is dismissed.
 *
 * A plain `DialogV2` rather than an ApplicationV2 of its own: the question is one row of buttons,
 * and this module already borrows the system's dialog theming by marker class everywhere else
 * (docs/adr/0002). `rejectClose` defaults to `false`, so dismissing resolves to `null` instead of
 * throwing.
 */
async function promptRoller(item: LooseStationAction, choices: RollerChoice[]): Promise<ResolvedRoller | null> {
  const buttons = choices.map((choice, index) => ({
    // `action` has to be unique per button and is never read - the callback's return value is what
    // `DialogV2.wait` resolves to.
    action: `roller-${index}`,
    label: choice.label,
    icon: choice.icon,
    callback: () => choice.resolved,
  }));

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: [MODULE_ID, "daggerheart", "dh-style", "dialog", "station-roller-prompt"],
    window: { title: game.i18n!.localize("DHSCIFI.Spaceship.StationActions.Prompt.title") },
    content: `<p>${game.i18n!.format("DHSCIFI.Spaceship.StationActions.Prompt.body", { name: item.name })}</p>`,
    buttons,
  });

  return (chosen as ResolvedRoller | null) ?? null;
}

/**
 * Run the Station action as `actor` - the crew branch of docs/adr/0003.
 *
 * The action is picked first (this is where "roller, then action" is enforced), then re-created
 * against the character's `system` and used. `new cls(...)` mirrors daggerheart's own
 * `actionUseButton`, which builds a rest move's action against a parent chosen at press time.
 *
 * The copy's `update` is redirected to the ship's own action document, which is what keeps limited
 * uses on the ship in both modes (#25). Without it a re-parented action writes `system.actions` to
 * the *character*, which has no such field - the write is silently dropped and a once-per-session
 * move recharges for free. Delegating to the original action rather than rebuilding its path also
 * means the ship's action stays the one authority on where it is stored. Assigning over the
 * inherited method is safe because the copy is ours: it exists for this one press and is never
 * embedded anywhere (Foundry seals a DataModel's `_source`, not the instance).
 */
async function useAsActor(item: LooseStationAction, actor: LooseRollActor, event: PointerEvent): Promise<void> {
  const action = await selectAction(item, event);
  if (!action) return;

  const cls = daggerheartApi()?.models?.actions?.actionsTypes?.[action.type];
  if (!cls) {
    console.warn(`${MODULE_ID} | Unknown daggerheart action type "${action.type}" - cannot roll it as the crew.`);
    return;
  }

  const reparented = new cls(action.toObject(), { parent: actor.system });
  reparented.update = (updates, options) => action.update(updates, options);

  await reparented.use(event);
}

/**
 * Which of the feature's actions to run, mirroring `DHItem#use`'s own choice: its only action, or
 * the one daggerheart's `ActionSelectionDialog` returns - including that method's shift-click
 * fast-path, which skips the dialog and takes the first action.
 *
 * `undefined` for a feature carrying no actions at all, which is `DHItem#use`'s own no-op: the
 * wrench dialog creates Station actions blank, so an unconfigured one is an ordinary state.
 */
async function selectAction(item: LooseStationAction, event: PointerEvent): Promise<LooseActionDocument | undefined> {
  const actions = [...(item.system.actionsList ?? [])];
  if (actions.length === 0) return undefined;
  if (actions.length === 1 || event?.shiftKey) return actions[0];

  const dialog = daggerheartApi()?.applications?.dialogs?.ActionSelectionDialog;
  if (!dialog) {
    console.warn(`${MODULE_ID} | daggerheart's ActionSelectionDialog is unavailable - using the first action.`);
    return actions[0];
  }

  return (await dialog.create(item, event)) ?? undefined;
}
