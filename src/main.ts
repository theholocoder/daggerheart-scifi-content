import "./styles/main.scss";

import { MODULE_ID, SPACESHIP_ACTOR_TYPE } from "./module/constants";
import SpaceshipData from "./module/data/actors/spaceship-data";
import SpaceshipActorSheet from "./module/applications/sheets/spaceship-actor-sheet";
import registerCharacterOnlyPatches from "./module/compat/character-only-patches";

Hooks.once("init", async function () {
  console.log("DHSciFi | Initializing...");

  Object.assign(CONFIG.Actor.dataModels, {
    [SPACESHIP_ACTOR_TYPE]: SpaceshipData,
  });

  registerCharacterOnlyPatches();

  // Shared Handlebars partials for the sheet's item lists, named after (and split the same way
  // as) daggerheart's own `daggerheart.inventory-items`/`daggerheart.inventory-item` pair, but
  // module-owned copies - the Inventory (#6) and Features (#7) tabs render through both, exactly
  // as the character sheet's own two tabs share the system's pair. Not `loadTemplates`-ing
  // daggerheart's actual files, which would be the live template dependency
  // docs/adr/0002-spaceship-sheet-independent-application.md rules out.
  await foundry.applications.handlebars.loadTemplates({
    "dhscifi.inventory-items": `modules/${MODULE_ID}/templates/actors/spaceship/partials/inventory-fieldset-items.hbs`,
    "dhscifi.inventory-item": `modules/${MODULE_ID}/templates/actors/spaceship/partials/inventory-item.hbs`,
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
});

Hooks.once("ready", async function () {
  console.log("DHSciFi | Ready...");
});
