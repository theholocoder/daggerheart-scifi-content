import { MODULE_ID } from "../../constants";
import type SpaceshipData from "../../data/actors/spaceship-data";
import { renderStoredTiers } from "./spaceship-levelup-state";

const BaseApp = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

/**
 * Read-only review of a ship's level-up history (#12) - the "Selections are stored per level and
 * can be reviewed after the fact" half of the ticket, and the counterpart of daggerheart's
 * `DhlevelUpViewMode`.
 *
 * A separate, much smaller application than the wizard rather than a mode flag on it: it has no
 * per-level budget, no navigation, and nothing to write, so all it needs is the same grid with
 * every box disabled.
 */
export default class SpaceshipLevelupView extends BaseApp {
  readonly actor: Actor.Implementation;

  constructor(actor: Actor.Implementation) {
    super({});
    this.actor = actor;
  }

  override get title(): string {
    return game.i18n!.format("DHSCIFI.Spaceship.Levelup.viewModeTitle", { actor: this.actor.name });
  }

  static override DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "spaceship-levelup", "daggerheart", "dialog", "dh-style", "levelup"],
    position: { width: 1000, height: "auto" as const },
    window: {
      resizable: true,
      icon: "fa-solid fa-clock-rotate-left",
    },
  };

  static override PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/actors/spaceship/levelup/view-mode.hbs` },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _prepareContext(options: any): Promise<any> {
    const context = await super._prepareContext(options);
    const system = this.actor.system as unknown as SpaceshipData;
    return Object.assign(context, { tiers: renderStoredTiers(system.levelups) });
  }
}
