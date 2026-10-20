# Android league entry and commissioner settings repair

Reported league: `9626adca-bda9-4be6-9f24-0737f36841da`.

## Confirmed live failures

- On direct mobile league entry, rail artwork rendered at 1,034 × 1,274 pixels. NativeLeagueWorkspace reused core rail markup without importing the stylesheet that sizes that artwork.
- GuillotineFirstEntryModal requested `/guillotine/Guillotine.mp4`, which is absent from the release. The packaged clip is `/media/create-league/concept/videos/Guillotine.mp4` (H.264/AAC).
- The league-type confirmation endpoint changed leagueType but retained the Guillotine runtime flags and leagueVariant. The live league consequently said Redraft in Format and Guillotine in its header and rules.
- The Teams row had no edit target. Settings saves also left the league header and manager seats on their original server snapshot.
- The live page currently shows three joined managers. This work addresses stale snapshots; it does not claim a failed third membership was found.

## Changes

Import shared rail styles on direct navigation and independently constrain artwork and the mobile rail. Use the packaged intro with muted inline autoplay, sound control, retry/error recovery and an always reachable entry button. Synchronize native format flags/variant/settings through both settings and type-confirmation saves. Refresh league props after saves, on returning to the page, and every 30 seconds while visible, without interrupting an active input.

Expose team count in General. Resize native pre-draft seats, draft-session capacity/order and saved draft order in one serializable transaction. Shrinking refuses claimed or populated seats and only removes canonical empty open seats at the end. Existing draft/season locks remain enforced. No schema migration.

## Validation

- Seven targeted Vitest files: 68 tests passed, covering the rail, intro, commissioner saves, conversion and retained Guillotine configuration.
- ESLint of changed backend, General, intro, autosave and LeagueShell: no errors; one existing LeagueShell hook-dependency warning.
- Browser fixture using the real rail CSS and full-size artwork at 360, 390 and 412 pixels: heading and settings remain visible; artwork stays contained.
- Packaged intro codec markers: avc1 and mp4a.
- Full repository TypeScript check exhausted the default 4 GB heap. An 8 GB retry was stopped after prolonged contention; the scoped new-backend-module check passed. No successful full typecheck is claimed.

The season engine now ignores retained Guillotine configuration when a native league explicitly uses another format. Imported and untyped legacy classification remains compatible.

An isolated test database roundtrip passed native NBA conversion with retained configuration, expansion and safe shrink, occupied-seat and started-draft protection, and persistence of name, timezone, draft clock/rounds/date, waivers, trades and playoffs. Temporary fixtures were removed. The test database emitted existing subscription-schema warnings; the commissioner save assertions passed.

## Outstanding release checks

This branch is not deployed. Run normal CI, then verify direct invite entry, settings, and playback with responsive Chrome, as authorized by the user. The local browser fixture is not a physical-device or Samsung Internet certification. On release, re-save Redraft on the reported league to repair its already-stored Guillotine flags; renaming alone never changes league format.

Rollback: revert this patch. Do not repeatedly resize live leagues as a rollback mechanism.
