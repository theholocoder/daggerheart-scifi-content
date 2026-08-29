import "./styles/main.scss";

import { MODULE_ID, SPACESHIP_ACTOR_TYPE, SYSTEM_ITEM_TYPE } from "./module/constants";
import SpaceshipData from "./module/data/actors/spaceship-data";
import SystemItemData from "./module/data/items/system-item-data";
import SpaceshipActorSheet from "./module/applications/sheets/spaceship-actor-sheet";
import SystemItemSheet from "./module/applications/sheets/system-item-sheet";
import registerCharacterOnlyPatches from "./module/compat/character-only-patches";

Hooks.once("init", async function () {
  console.log("DHSciFi | Initializing...");

  Object.assign(CONFIG.Actor.dataModels, {
    [SPACESHIP_ACTOR_TYPE]: SpaceshipData,
  });

  Object.assign(CONFIG.Item.dataModels, {
    [SYSTEM_ITEM_TYPE]: SystemItemData,
  });

  registerCharacterOnlyPatches();

  // Shared Handlebars partials for every document list in this module, named after (and split the
  // same way as) daggerheart's own `daggerheart.inventory-items`/`daggerheart.inventory-item`
  // pair, but module-owned copies. The Spaceship sheet's Inventory (#6), Features (#7), Stations
  // (#8) and Effects (#9) tabs and the System item sheet's Actions and Effects tabs (#15) all
  // render through them - exactly as daggerheart shares *its* pair between its character, npc,
  // adversary, environment and party sheets. Not `loadTemplates`-ing daggerheart's actual files,
  // which would be the live template dependency
  // docs/adr/0002-spaceship-sheet-independent-application.md rules out.
  await foundry.applications.handlebars.loadTemplates({
    "dhscifi.inventory-items": `modules/${MODULE_ID}/templates/partials/inventory-fieldset-items.hbs`,
    "dhscifi.inventory-item": `modules/${MODULE_ID}/templates/partials/inventory-item.hbs`,
  });

  // Builds the pip-row array for a `{value, max}` resource (Hope/HP/Stress), so sheet templates
  // can `{{#each}}` over plain box objects. Registered here (own helper) rather than relying on
  // `daggerheart`'s own `times` helper, per docs/adr/0002-spaceship-sheet-independent-application.md.
  Handlebars.registerHelper("dhscifiResourceBoxes", (value: number, max: number) => {
    return Array.from({ length: max }, (_, i) => ({ index: i + 1, filled: value >= i + 1 }));
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor.implementation, MODULE_ID, SpaceshipActorSheet, {
    types: [SPACESHIP_ACTOR_TYPE],
    makeDefault: true,
    label: "TYPES.Actor.daggerheart-scifi-content.spaceship",
  });

  foundry.applications.apps.DocumentSheetConfig.registerSheet(Item.implementation, MODULE_ID, SystemItemSheet, {
    types: [SYSTEM_ITEM_TYPE],
    makeDefault: true,
    label: "TYPES.Item.daggerheart-scifi-content.system",
  });
});

Hooks.once("ready", async function () {
  console.log("DHSciFi | Ready...");
});
