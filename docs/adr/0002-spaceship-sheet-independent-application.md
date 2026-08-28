# Spaceship sheet is an independent ApplicationV2 class, not a subclass of daggerheart's exposed sheet API

Status: accepted

Resolves the open spike from [#4](https://github.com/theholocoder/daggerheart-scifi-content/issues/4): whether `game.system.api.applications.sheets.api` safely exposes `DHApplicationMixin`/`DHBaseActorSheet` for cross-module extension.

## Finding

`game.system.api.applications.sheets.api.{DHApplicationMixin, DHBaseActorSheet}` are genuinely exported (`daggerheart/module/applications/sheets/api/_modules.mjs`) and nothing prevents importing them from another module. But both are unsafe to subclass for a foreign, module-registered Actor subtype:

- `DHApplicationMixin#_renderFrame` (called on every render) unconditionally reads `this.document.system.metadata.hasAttribution`.
- `DHBaseActorSheet#_prepareContext`/`#_configureRenderParts` unconditionally read `system.metadata.hasInventory`, `system.metadata.hasLimitedView`, and `system.metadata.settingSheet`.
- `metadata` is an undocumented, unversioned contract internal to daggerheart's own actor DataModels (`character`, `adversary`, `npc`, `environment`, `companion`). It is not part of any published extension API, so subclassing either class would force our Spaceship DataModel to shadow that private shape and would silently break on any daggerheart internal refactor.
- `fvtt-types` (our only type source, `tsconfig.json`) has no knowledge of `game.system.api` at all — every access would need `any`/unsafe casts, defeating `strict`/`noImplicitAny`.

## Decision

Build the Spaceship sheet as a fully independent class: `foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)`, with our own `PARTS`/`TABS`, our own Handlebars templates (`templates/`, module-namespaced), and our own CSS. No import from `game.system.api`. This keeps the sheet fully typed under `fvtt-types` and immune to daggerheart internal refactors — the only contract we depend on is core Foundry's ApplicationV2/DocumentSheetV2 API.

This decision applies to all future Spaceship-sheet work (stations, crew assignments, weapon mounts, ship level-up — [#5](https://github.com/theholocoder/daggerheart-scifi-content/issues/5)-[#9](https://github.com/theholocoder/daggerheart-scifi-content/issues/9)): keep extending our own independent base sheet class rather than reaching into `game.system.api.applications.sheets.api`.

Reading daggerheart's system-registered `game.settings` (e.g. the resource-pips appearance setting) or reusing its `armor`/`weapon` Item types on the ship Actor, as already decided in [[0001-spaceship-actor-subtype]], stays fine — that's public/system-scoped state, not a private sheet-class contract.

## Addendum: `system.metadata` and `system.getRollData()` are unavoidable, just not from the sheet

Testing surfaced that daggerheart's `Actor`/`Token` **document** classes read a small, undocumented contract off `system` unconditionally — `CONFIG.Actor.documentClass`/`CONFIG.Token.objectClass` are world-global, not overridable per sub-type, so they run for every Actor in the world regardless of which module registered its type:

- `DhpActor#_preCreate` reads `this.system.metadata.usesSize` on every Actor creation.
- `documents/token.mjs` and `documents/tokenManager.mjs` read `actor.system.metadata.usesSize` on token creation/placement.
- `applications/sidebar/tabs/actorDirectory.mjs` reads `actor.system.metadata.usesSize` on every render of the Actors sidebar list.
- `DhpActor#getRollData` unconditionally calls `this.system.getRollData()` — itself called from core Foundry's `applyActiveEffects` during every data-preparation pass, i.e. on every Actor create/update/render.

Without these, creating a Spaceship actor throws (`this.system.metadata is undefined`, then `this.system.getRollData is not a function`) and, worse, once one exists it breaks the whole Actors sidebar. This isn't a sheet-reuse question, so it doesn't reverse the Decision above: `SpaceshipData` (`src/module/data/actors/spaceship-data.ts`) defines its own `metadata` static/instance getter (matching the shape of daggerheart's own `BaseDataActor.metadata`, `module/data/actor/base.mjs`, every flag at its safe/inert default) and its own minimal `getRollData()` (mirroring `BaseDataActor.getRollData`'s default). Future Spaceship DataModel work should keep both in sync if new unconditional `system.*` reads are found in daggerheart's document-level code (as opposed to its sheet code, which we still don't touch).
