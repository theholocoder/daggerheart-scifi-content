import { MODULE_ID } from "../../constants";

const BaseSettings = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2);

/**
 * "Configure Spaceship" dialog, mirroring the official Character Settings application
 * (`DHCharacterSettings`/`DHBaseActorSettings` in the `daggerheart` bundle): an `ActorSheetV2`
 * instantiated manually alongside the main sheet - not registered via `DocumentSheetConfig` -
 * with `submitOnChange` so every edit updates the actor immediately and the main sheet
 * re-renders. Two ActorSheetV2 instances on one actor coexist because `DocumentSheetV2`
 * namespaces the application id by class name.
 *
 * The `daggerheart`/`dh-style`/`dialog` marker classes opt into the system's public dialog
 * theming (`.application.daggerheart.dh-style.dialog` rules: `.dialog-header`, `.tab.details`,
 * `.traits-inner-container`, fieldsets), same borrow-by-marker-class approach as the main sheet
 * (docs/adr/0002-spaceship-sheet-independent-application.md).
 */
export default class SpaceshipSettings extends BaseSettings {
  static override DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "spaceship-settings", "daggerheart", "dh-style", "dialog"],
    window: {
      icon: "fa-solid fa-wrench",
      resizable: false,
      title: "DHSCIFI.Spaceship.Settings.title",
    },
    position: {
      width: 455,
      height: "auto" as const,
    },
    form: {
      submitOnChange: true,
    },
  };

  static override PARTS = {
    header: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/settings/header.hbs`,
    },
    details: {
      template: `modules/${MODULE_ID}/templates/actors/spaceship/settings/details.hbs`,
    },
  };

  // Unlike the official `DHBaseActorSettings` we keep core's `sheet` class on the frame:
  // the only `.sheet`-scoped system rules that could reach this dialog's markup set a CSS
  // variable or target item-sheet structures it doesn't contain, and removing the class needs
  // an override (`_initializeApplicationOptions`/`_renderFrame`) that trips fvtt-types'
  // deep class-comparison into an excessive-stack-depth error.
}
