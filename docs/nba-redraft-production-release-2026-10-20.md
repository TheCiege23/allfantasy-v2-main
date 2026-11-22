# NBA redraft production release — 2026-10-20

Prepared from production main e69537f9caf1305f0dc15b3c1dbed10e1b3e0467 in an isolated checkout. The shared working tree was not shipped.

The earlier 26-file rehearsal capture predates newer production chat, daily-lineup, draft-order, dynasty and tournament work. This release preserves those implementations and ports the applicable NBA fixes:

- Enable NBA on the existing daily-sport live scorer by default; explicit off remains available. Preserve its two-account transport, persisted cadence, payload/line hashes, sealed-week guard, NFL path and NHL/MLB opt-in.
- Persist authoritative game state alongside live box writes, using the shared schedule source, and retain actual game timestamps in normalized player data.
- Award records and median results only for final matchups.
- Retry archives after champion persistence. Serialize archive creation and preserve tournament/roto/dynasty results.
- Archive-first, serializable native NBA renewal with an expected-season receipt; next season has empty roster links and a new draft. Preserve commissioner draft-order options and rules; cancel outstanding claims/trades and clear current lineup locks. Keep historical players, picks, results and chat.
- Native season/draft history with membership guards and archived rank ordering; fix current-period legality, NBA mock athlete identity and the basketball intro.

Validation before commit: 104 tests passed in 13 files. The production-source NBA DB replay passed with all writes rolled back: positive live scores, no live wins, final records, archive retry, manual-order renewal, idempotent retry, four empty next-season roster links and unchanged 52 old players / 52 old picks. The transitive release type comparison reported 18 baseline errors and the same 18 release errors, zero new diagnostics. No Prisma/schema migration is part of this release.

Evidence: tmp/nba-redraft-friends-fix/release-regression-final.log, release-type-comparison.json, release-db-lifecycle-final.log. Production deployment IDs, serving SHAs and post-deploy checks are recorded separately after rollout; this preparation note does not claim production acceptance.
