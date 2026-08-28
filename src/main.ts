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
