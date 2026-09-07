# Station actions choose their roller by re-parenting the action, not by rewriting it

Status: accepted

Station actions ([[station-action]] in CONTEXT.md) must sometimes roll as the Spaceship and sometimes as the crew member sitting at the Station - the Pilot's "Maneuver" is an Agility Action Roll, and whether that is the *ship's* Agility or the *pilot's* is a per-action authoring decision, not a fixed rule.

## Finding

In `daggerheart`, an Action's roller is *entirely* determined by its parent chain, and by nothing else:

- `DHBaseAction#item` returns `this.parent.parent`; `#actor` returns that if it is an Actor, else `item.parent`.
- `RollField.execute(config)` calls `this.actor.diceRoll(config)`. `prepareBaseConfig` builds `resourceUpdates: new ResourceUpdateMap(this.actor)` and `data: this.getRollData()`.
- So the trait rolled, the Hope/Fear duality dice, the experiences offered in the roll dialog, and the Hope/Stress spent all follow `action.actor`, with no per-call override anywhere in the workflow.

The system already exploits this itself: `actionUseButton` (rest moves) constructs an action with `new cls({...actionData}, { parent: someActor.system })` and calls `use(event)` on it, where `someActor` is chosen from a dropdown at press time - the action data lives in settings, unowned by anybody, and the *roller* is picked per press.

Ship and character both key their traits identically (`system.traits.agility.value`, etc.), so one authored feature is meaningful against either parent with no translation layer.

## Decision

A station action's `roller` flag (`ship` / `crew` / `ask`) selects an Actor at press time, and the action is used as that Actor:

- `ship`: use the owned Item's own action directly. Its parent chain already ends at the Spaceship, so `action.use(event)` is untouched system behavior.
- `crew` / `ask`: re-instantiate the action against the chosen PC - `new cls(action.toObject(), { parent: crewActor.system })` - and `use(event)` that instance, following `actionUseButton`'s own precedent.

Costs follow the roller by construction: a crew-rolled action spends the PC's Hope and Stress, because `ResourceUpdateMap` is built from `this.actor`. That is the intended reading, not a side effect we tolerate.

## Considered and rejected

- **Always roll as the ship, with a modifier drawn from the crew member.** Keeps one parent and one code path, but it can't express "the pilot's own Agility and Hope are on the line", makes every crew-flavored action a bespoke formula, and quietly diverges from how the same feature would behave on a character sheet.
- **Store station actions on the crew PC instead of the ship.** Would make crew rolls free, but ship-rolled actions then have the wrong parent, actions vanish when crew is reassigned, and the ship stops being the thing that owns its own capabilities.
- **Patch `RollField`/`DHBaseAction` to accept a roller override.** A live dependency on system internals, which [[0002-spaceship-sheet-independent-application]] rules out for exactly this class of coupling.

## Consequences

- A re-parented action is a *copy*: `uses` consumption and Active Effects resolve against the ship's item (`systemPath`/`originItem` are preserved), while resources resolve against the PC. Anything later added to the workflow that reads the parent for *item* state rather than *actor* state needs re-checking against this split.
- The chat card's speaker is the PC in crew mode, and says nothing about the ship or station. Deliberately left alone for now rather than reaching into the system's chat templates.
