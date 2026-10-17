# NBA Survivor pilot readiness

The commissioner can configure a league and start a native draft, but the current build is **not ready for an unattended public full-season league**. Use a closed rehearsal league until the launch gates below pass end to end.

## Rules agreed for the NBA pilot

- Fantasy weeks run Tuesday through Monday in US Eastern time. The existing generic daily-sport week window still uses a UTC opener anchor; that must be corrected for this format before real scoring starts.
- Commissioners choose all-games scoring or one pregame game per player each week. If no selection is made, the player's first game of that week is selected automatically. The pregame selection, lock, and score pipeline remain to be built.
- Playing commissioners can change settings and approve or postpone a system-random tribe redraw at the 40% threshold, but cannot see private ballots, hidden idols, or other tribes' huddles.
- Shot in the Dark is one hidden use per manager with a 1-in-6 success probability. Its persisted use and official reveal are not yet implemented.
- Exile is on by default. A voted-out manager's main roster is released; one qualifying manager with the highest token balance returns at the configured deadline. The weekly host/Chimmy score-to-beat rule awaits the commissioner's examples.
- Idols follow real drafted players through trades, elimination, waivers, and claims. Only the current holder can see a hidden idol. Direct idol transfers are blocked in the native NBA pilot.

## Implemented in this branch

- Private `@Chimmy @manager` ballots and correction messages from the league, tribe, and draft chat entry points; official vote validation remains server-side.
- Post-create idol count setting, with draft-start lock, and seeding onto real completed-draft picks using only the three powers whose effects are implemented.
- Private idol assignment notice with the bound player's name and available headshot.
- The native draft-to-season roster bridge and transactional idol changes during trades, reversals, waiver claims, drops, and elimination.
- Private inventory follows the current owner, including while an idol-bearing player is on waivers.
- On 2026-10-15, `scripts/verify-nba-survivor-20-draft.ts` completed an isolated 20-manager, 12-round NBA Survivor draft with 240 verified current NBA players. It exercised draft start, pause/resume, a queue-first expired-timer pick, reciprocal traded picks, all 240 saved pick-chat cards, automatic completion, 20 season rosters, four tribes, and seven private idol notices. The synthetic league and managers were removed after verification; no production league was changed.

## Launch gates, in order

1. Build and verify Tuesday-to-Monday Eastern NBA scoring for both commissioner-selected modes, including daylight-saving changes, pre-tipoff locks, missed picks, stat corrections, and finalization.
2. Finish the draft rehearsal with actual users in browsers: scheduling, multi-device reconnect, live chat rendering, commissioner pick correction, private idol notice display, and commissioner blind mode. The isolated service-level 20-manager draft and its saved artifacts passed on 2026-10-15, but those browser and role checks remain.
3. Persist Shot in the Dark, implement the 40% tribe-switch prompt and unbiased redraw, and test member/huddle access before and after elimination and merge.
4. Define the Exile weekly score-to-beat contest from the commissioner examples; then verify token reset, challenge rewards, weekly roster exclusivity, and the single deadline return.
5. Verify the full weekly challenge slate, official ballots and Torch reveal, commissioner recovery controls, and season-finale flow under scheduled automation. The planned-season runner currently requires an enablement flag; confirm its production schedule and idempotent retries.
6. Complete a multi-account, full-week dry run with a playing commissioner and a non-playing commissioner before invitations extend beyond testers.

## Beta-invite safeguards, 2026-10-17

- Commissioner pause now freezes the league. The planned-season runner, the five-minute score bridge and the tribe sit-out batch all skip a league with a `pausedSnapshot`; before this, pause set only that column while the runner checked `phase`, so a paused league kept opening councils and eliminating managers.
- `adjust_score` is stored as point boost or penalty, which the five-minute score sync preserves. It previously wrote `finalScore` directly and the next sync recomputed it away.
- Queued Survivor notifications are delivered by the score-sync cron. The only sender used to be `/api/survivor/automation`, which no scheduler calls. Each row is claimed before delivery, and rows more than a day past due are retired rather than sent.
- A scheduled draft start notifies every manager, as a manual start already did. If seats are still unclaimed at draft time, the commissioner gets one notice explaining why the draft is waiting.
- The legacy `idols/play` route now checks that the caller owns the idol and claims it atomically.
- Still to set in production, outside the repo: `DRAFT_TICK_CRON_ENABLED=true` on the worker service for unattended expired-pick autopick, and confirm NBA ADP rows exist for this season before the draft.

## 16-manager rehearsal, 2026-10-17

- `scripts/verify-nba-survivor-20-draft.ts` now takes `--cast=16` (20 stays the default), and `e2e/nba-survivor-authenticated-rehearsal.spec.ts` reads `AF_NBA_SURVIVOR_CAST`.
- `--cast=16` completed a 16-manager, 12-round draft end to end: start, pause and resume, the queue-first expired-timer pick, a paused commissioner correction with its audit row, reciprocal traded picks, 192 picks with 192 pick-chat cards, automatic completion, 16 season rosters, four tribes, and six private idol notices. The default 20-seat run also passed on the same database after the change.
- This run used a local Postgres built with `prisma db push`, holding only the bootstrap `allfantasy` tenant row and 400 generated active NBA players. It proves the 16-seat draft mechanics, not production player data. Production freshness is enforced again at draft start by `survivorDraftStartReadiness`, and the 2026-10-15 run covered real players.
- A draft before 2026-10-20 opens on week 1. A draft completed later opens on the following Tuesday–Monday week, because `reconcileSurvivorDraftPlan` rebases the saved plan to the draft's completion time.
- The two-browser spec ran three times at 16 seats against `next dev` on the same local database, on a 4-core cloud container. Every step through the commissioner submitting a pick correction passed in at least one run: sign-in for two distinct managers, the schedule save and the manager's rejected edit, the pool and board rendering in both browsers, the draft start, the commissioner pause, the manager seeing the paused banner through live sync, the manager's rejected pick correction, live board updates, and opening and filling the commissioner editor. No run finished. Each stopped at a different step, and in the last one the dev server stopped accepting connections, so these failures reflect the container rather than the draft room. Still unverified in a browser at 16 seats: the self-benefit confirmation and success message, the owner-only idol vault, and the private notice. Run the spec on a normal workstation or staging before the friends' draft, then hold the real-device draft with test accounts.

## Phase 2 gameplay, 2026-10-17

- Jury: `resolveElimination` seats every manager voted out after the merge (game phase `merge`, `post_merge`, `jury` or `finale`) on the jury in the same transaction as the elimination. It writes `SurvivorJuryMember` with the legacy roster id the finale vote route resolves, sets `isJuryMember`, and records a `jury_joined` audit entry. Previously only the legacy council path enrolled jurors, so the planned season's finale could never open.
- Idol arrival: when a player-bound idol reaches a new manager by trade, waiver claim or roster raid, that manager gets a private Chimmy notice with the player's name, headshot and the idol's power. Drops to waivers notify nobody.
- Shot in the Dark: `@Chimmy shot in the dark` in any private Chimmy path, once per manager per season, only while voting is open and before that manager has voted. It gives up the manager's vote and rolls a sealed 1-in-6 (`node:crypto` `randomInt`), stored on `council.idolsPlayed` and in a private `shot_in_the_dark_played` audit entry that even the commissioner cannot see. If the roll is safe, the tally and the autonomous fallback treat it like a Vote Shield. The Torch Ceremony announces each result before the ballots are read. No schema change.
- Exile boss (owner's rule, 2026-10-17): Chimmy fields a weekly Exile roster under the exiles' own rules. It takes the open NBA team with the most games left in the week, anchors on a point guard, and fills slots by recent finalized fantasy average. `ensureChimmyBossRoster` builds it on the season tick once anyone is on Exile. In `scoreExileWeek`, the top exile score earns a token unless Chimmy's score is strictly higher. In that case no token is awarded, every Exile token balance resets to 0 (a Token Shield idol still protects its holder), and Chimmy announces it in the Exile chat. An exile who fielded no roster scores zero. The commissioner cannot play the boss yet, because that needs a host roster screen.
- Stat corrections after a week is sealed (owner's rule, 2026-10-17): final is final. Sealed scores, immunity, votes and eliminations never change, which is the existing behavior.
