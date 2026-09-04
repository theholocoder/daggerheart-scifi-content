# Spaceship as a module-registered Actor subtype, not a reused `adversary` type

Status: accepted

Existing spaceship content (frame stat blocks, NPC ships) piggybacks on the `daggerheart` system's `adversary` Actor type, encoding stats like crew capacity as text inside embedded `feature` items. For the player-facing Spaceship sheet we instead register a brand-new Actor subtype (`daggerheart-scifi-content.spaceship`) via Foundry's module `documentTypes` manifest mechanism, with our own DataModel and sheet, rather than reusing `adversary`'s schema with a swapped-in sheet.

We picked this because `adversary`'s schema is shaped for NPC stat blocks (difficulty, hordeHp, motives/tactics) and doesn't fit Spaceship-specific data (stations, crew assignments, system points, weapon mounts) without more hacks. The trade-off: Foundry namespaces module-provided subtypes as `<module-id>.<subtype>`, and the `daggerheart` system's own UI conveniences (Actors sidebar grouping, Party actor's `partyMembers`, compendium browser) are hard-coded to its six built-in types — a foreign subtype gets our sheet but not that integration for free. We're accepting that gap deliberately for v1 (Spaceships excluded from Party membership; see CONTEXT.md) rather than reusing `adversary` to dodge it.

Existing `adversary`-based frame entries are left as-is; equivalent Spaceship-subtype entries will be added by hand.
