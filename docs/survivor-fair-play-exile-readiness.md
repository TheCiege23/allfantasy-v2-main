# Survivor fair play and Exile readiness

Updated 2026-10-12. This release is a foundation release, not certification of an unattended season.

## Accepted rules

- Playing commissioners and co-commissioners use manager visibility even if a saved setting calls them hosts. Elimination or Exile does not grant host secrets.
- Non-playing hosts can oversee private game state. Personal DMs and alliances remain participant-only.
- Votes go privately to `@Chimmy vote @manager` (or a verified `<@userId>` mention). The deterministic ballot service records the authenticated voter. Closed/tallied councils remain secret until explicitly revealed.
- User-facing council name: Elimination Council; public reveal event: Torch Ceremony. Naming changes do not establish trademark clearance.
- Exile is enabled by default, can be disabled before drafting, and receives managers voted off the main island. Their main-island roster is released to waivers.
- One manager may return after the configured week's verified Exile results. The minimum is configurable (default four tokens, week ten). Highest current tokens wins; ties use lifetime tokens, longest Exile stay, then stable manager ID. Deadline snapshots prevent later earnings from changing the result. No qualifier means no return.
- A returned manager rebuilds through normal waivers. Repeated settlement cannot grant another return or token award.
- Triple Raid takes three players from one opposing team; Island Raid takes three across opposing teams. These are distinct catalog definitions and remain unavailable until transfer enforcement exists.

## Implemented in this release

Server-side access checks on manual game controls, council response allowlists, restricted audit/event feeds, own-inventory filtering, guarded private channels, authenticated private voting, truthful vote confirmations, atomic public Torch Ceremony publication, Exile enrollment with roster release, token settlement finalization guards, scheduled return settlement, pre-draft Exile settings, and NBA/NHL creation-plan reservation for one possible return. Focused tests cover privacy, duplicate settlement, cutoff, zero-score finalization, and roster reactivation.

## Required before public full-season launch

1. Connect the canonical season conductor to actual NBA/NHL period windows and the saved elimination/rest calendar. Include restart recovery, deadline timezone/DST handling, score corrections, postponed games, ties/revotes, merge, jury and finale. Skip the reserved extra elimination if nobody returns; never eliminate below the finalist count.
2. Build the real Exile scorer and challenge submission/lock pipeline. It must produce `exile_results_finalized` only after verified provider results, create eligible entries, and cover separate Exile rosters/lineup locks. No producer exists yet: token settlement intentionally waits instead of interpreting default zeros as final results.
3. Unify idol storage and ownership with real player IDs. Randomly select about one-third of holders, permit multiple idols, transfer custody atomically with trades/waivers/release, implement expiry and one-time use, then enable both raid powers with capacity and game-lock enforcement.
4. Build weekly sport-specific featured-game and extra challenge/reward scheduling for both islands. NFL defaults are TNF tribe, SNF individual, MNF tribe; NBA/NHL need actual schedule-driven equivalents and commissioner-configurable windows.
5. Connect the atomic ceremony publication to the weekly scheduler and live notification delivery, and generate storylines only from the viewer's permitted facts. Audit every remaining legacy read/AI endpoint before claiming complete secrecy coverage.
6. Replay complete NBA and NHL seasons against an isolated database with real provider contract fixtures, including draft completion, waivers, trades, elimination, Exile, return, and championship. Mock-based unit tests alone do not certify database rollback or a complete season.

Creation supports the existing 16–20-manager range. A 24-manager cast is not certified. Zombie and Tournament follow Survivor; neither is certified by this release.
