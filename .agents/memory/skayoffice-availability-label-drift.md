---
name: SkayOffice availability label drift
description: The isOnline boolean's "false" state label drifted between components; how it was unified.
---

The `offices.isOnline` boolean is the only availability signal in the data model — there is no separate in-person/closed field. `QuickOfficeCard` and the office-profile Decision Card each had their own translation key for the `isOnline === false` state ("In-Person Only" vs "Offline"), so the same boolean showed contradictory wording depending on which component rendered it.

**Why:** any UI surface that derives a label from a shared boolean/enum is prone to this drift when each component owns its own copy instead of a single i18n key — nothing enforces consistency across files.

**How to apply:** when touching a status label driven by a shared field, grep all render sites for that field (not just the one you're editing) and route them through one shared translation key. For SkayOffice specifically, both cards now use `card.available_in_person` for the false/non-online state.
