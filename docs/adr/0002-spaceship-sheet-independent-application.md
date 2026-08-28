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
