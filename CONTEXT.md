# Daggerheart Sci-Fi Content

FoundryVTT module adding sci-fi content (spaceships, sci-fi character options) on top of the external `daggerheart` system. This module owns its own compendium content and, going forward, its own module-registered Actor/Item subtypes and sheets — it does not modify the `daggerheart` system's code.

## Language

**Spaceship**:
A player-facing Actor subtype (`daggerheart-scifi-content.spaceship`, module-namespaced per Foundry's module sub-type mechanism) representing a crewed vehicle, sheet-designed as a sibling to the `daggerheart` system's `character` type: same core resource shape (Hope, HP, Stress, Evasion, Shield, Proficiency, thresholds, level, features, equipment) but no domains/loadout, class/subclass, ancestry/community, rest, tag team, biography, or experiences.
_Avoid_: Ship, vehicle (this module also covers non-ship vehicles later; "Spaceship" is the concrete type being built now)

**Frame**:
The fluff/reference concept of a spaceship hull family (e.g. Fighter, Frigate, Patrol, Transport) and its tier. Not a structured Item or DataModel — a GM manually enters a spaceship's starting stats to match a frame's published numbers on a blank Spaceship sheet.
_Avoid_: Chassis, hull type (as a data concept — those are fine as flavor words)

**Shield**:
The Spaceship equivalent of a character's armor score. Derived from an equipped `armor`-type Item on the ship Actor (reusing the system's existing armor-item mechanic), same as characters derive `armorScore` and damage thresholds from equipped armor.
_Avoid_: Armor score (character-specific term, kept for Shield's UI label but the underlying item type is still `armor`)

**Station**:
One of five fixed, predefined crew roles on a Spaceship: Pilot, Mechanic, Commander, Systems Operator, Gunner. Each ship can enable/disable individual stations (some frames lack certain roles). An enabled station holds zero or more crew assignments.
_Avoid_: Position, role, seat

**Crew assignment**:
A drag-dropped reference (Actor UUID) linking a PC Actor to a Station on a Spaceship. One-way and non-persistent as a relationship: no back-link on the PC, no sync if the PC Actor is deleted or changes.
_Avoid_: Crew member (ambiguous between the PC Actor and the assignment record)

**Weapon Mount**:
One unit of a Spaceship's `maxWeaponMounts` capacity. One mount holds exactly one weapon Item, regardless of whether that weapon is primary or secondary — mirrors the character sheet's one-handed/two-handed weapon-pairing system (a two-handed/Heavy weapon fills its mount alone; a one-handed weapon can pair with a second one-handed weapon in a separate mount).
_Avoid_: Core/Support/Heavy weapon (older terminology, superseded by the one-handed/two-handed system)

**System Points**:
A Spaceship's only currency-like resource, replacing gold/credits entirely on the ship sheet. Tracks points available vs. spent on System items (Standard/Advanced), driven by the ship's base `systemPoints` stat plus the gains derived from its level-up records. Available is computed, never stored (`systemPoints` − `systemPointsSpent`), and deliberately uncapped below zero so an over-committed ship reads negative rather than silently swallowing the overspend. Only available is shown on the sheet - it is the balance a player spends against; the base total and the spent count are GM bookkeeping and stay on the wrench dialog.
_Avoid_: Currency, gold, credits (not tracked for ships)

**System** (Item):
A piece of installed ship equipment bought with System Points — Standard ones fitted when the ship is built, Advanced ones gained during play. Intended as a module-registered `system` Item sub-type modeled on `daggerheart`'s `loot` plus a `systemPointsCost` field (#15); until that lands, no such Item type exists and the spent half of System Points is a plain GM-entered `systemPointsSpent` number on the wrench dialog (#11), to be replaced by the sum of `systemPointsCost` over the ship's installed Systems.
_Avoid_: Module, upgrade, component

**Ship level-up**:
A level-up wizard for Spaceships mirroring the character level-up wizard's mechanics directly: same tier bands (1 / 2-4 / 5-7 / 8-10), same point-buy pattern of picking a fixed number of options per level. The option pool is a subset of the character's plus one ship-only entry: trait, hitPoint, stress, evasion, proficiency, and System Points — domainCard, subclass, experience, and companion-only options are excluded (no domains/subclass/experiences on ships). Entering a tier (levels 2, 5, 8) grants +1 Proficiency on its own, the ships-adapted remnant of the character's tier-entry achievements (whose other half is a new Experience). Supersedes the older party-level-linked milestone table (Tier Feature @2/5/8/10 etc.) from the rules journal, which is now obsolete.
_Avoid_: Tier progression (used loosely in the rules journal; "ship level-up" is the sheet-facing term)

**Level-up record**:
One entry of a ship's `system.levelData.levelups`, keyed by the level it belongs to: what that level granted on its own (`achievements`) and every checkbox ticked for it (`selections`, each carrying `tier`/`level`/`optionKey`/`checkboxNr`/`type`/`value`/`data`). Records are the *only* place level-up gains are stored — the ship's trait, HP, Stress, Evasion, Proficiency and System Point numbers stay the Frame's printed statline, and every level taken is layered on top of them in `prepareBaseData`. That is what makes the history auditable and de-levelling a matter of dropping records, and it is daggerheart's own arrangement for characters.
_Avoid_: Level-up log, advancement history (the sheet says "level-up"; a record is one level, not the whole history)

**Target level**:
`system.levelData.changed` — the level the GM has said a ship should reach, as opposed to `system.level`, the level it has actually taken. A gap between them is what arms the level-up wizard (`canLevelUp`); closing it is what the wizard's "Finish Level Up" does. Ships keep the taken level in the pre-existing `level` field rather than in a `levelData.level.current` beside `changed`, which is where daggerheart's characters keep theirs.
_Avoid_: Changed level (`changed` is the field name, not the term)
