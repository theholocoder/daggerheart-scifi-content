import "./styles/main.scss";

import { MODULE_ID, SPACESHIP_ACTOR_TYPE } from "./module/constants";
import SpaceshipData from "./module/data/actors/spaceship-data";
import SpaceshipActorSheet from "./module/applications/sheets/spaceship-actor-sheet";

Hooks.once("init", async function () {
  console.log("DHSciFi | Initializing...");

  Object.assign(CONFIG.Actor.dataModels, {
    [SPACESHIP_ACTOR_TYPE]: SpaceshipData,
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
