# Survivor Guillotine: confirmed rules and implementation

The user-approved rules in this document supersede conflicting illustrative rules in the design handoffs. The attached HTML files are visual references, not application code or instructions to execute their generators.

## Implemented foundation

- `lib/survivor-guillotine/config.ts`: typed commissioner defaults and scoring-period schedule validation for NFL and NBA.
- `lib/survivor-guillotine/competition.ts`: pure matchup validation, tribal immunity, elimination, immunity pass-down, final placement, and Gauntlet pick order.
- `lib/survivor-guillotine/powers.ts`: ownership reconciliation, visibility projection, activation guards, command parsing, and reveal timing.
- `lib/survivor-guillotine/rewards.ts`: server-only random draft attachments (exactly one guaranteed personal immunity idol) and concealed weekly reward records.
- `lib/survivor-guillotine/live.ts`: authenticated season storage, sealed power ledger, server-score chop execution, private reward delivery, transactional token actions, and waiver-pool release.
- `/survivor-guillotine/setup?leagueId=...`: responsive commissioner workshop. Loads and saves live rules for a league; export remains available.
- `/api/leagues/[leagueId]/survivor-guillotine`: member-safe season read and commissioner-only `rules`, `period` (requires the current revision and per-period ceremony/custom deadlines), `seed_draft_powers`, and `award_weekly_power` writes. The response never includes unearned powers or the reward recipient.
- `/api/leagues/[leagueId]/survivor-guillotine/chimmy`: private action activation; the league, direct Chimmy, Survivor Chimmy, and shared Huddle/DM chat routes also intercept commands before public posting.
- `/api/leagues/[leagueId]/survivor-guillotine/chop`: commissioner-only chop from finalized `TeamWeekResult` rows (or league-rule NBA capped-game totals). A serializable transaction records chops, clears legacy and redraft roster ownership, cancels pending claims from eliminated managers, reveals sealed idols, and updates eliminated flags. The normal FAAB processor then sees released players as unowned, blocks eliminated claimants, and mirrors winning claims into redraft player ownership. Immediate add/drop is disabled for this format. `POST {"action":"reconcile_correction"}` rechecks the latest completed period after final scores change.
- Existing vote-based Survivor, Guillotine persistence, and published Commissioner OS v1 templates remain unchanged.

## Season and competition

Football default: 22 managers; 2 starting tribes, customizable to 4. Weeks 1–10 alternate Match Play and Tribe Champion, chopping one manager each week. Weeks 11–13 are the Gauntlet, chopping two. Week 14 merges the remaining six; Weeks 14–16 chop one each. Week 17 ranks the final three by that week's score.

NBA uses weekly fantasy scoring periods. Commissioner selects the championship period; phases are scheduled backward from the finale. Commissioner chooses total points or capped player games and decides the treatment of shortened/extended periods. Explicit no-elimination periods affect team-count validation. Never assume football's Week 14 merge or a fixed NBA calendar.

Tribe formation and optional shuffles are commissioner choices. Tribes elect captains before the first period and vote for replacements after elimination. The commissioner chooses submission approval, matchup order (alternating/random/manual), and batch size (2 or 3). A matchup selection specifies both opposing teams. Each non-sitting team plays once. Unequal tribes choose extra members to sit out matchup competition; they remain chop-eligible and cannot sit out consecutive periods. Missing or invalid submissions go to the commissioner or a configured random fallback. Odd, unpairable fields require explicit commissioner resolution; no hidden bye or repeat matchup is invented.

Most matchup wins earns one tribe immunity. Champion periods use the highest nominated champion score. The lowest scorer across every unprotected tribe is chopped. The latest supplied screenshot supersedes earlier season-point/captain tiebreak answers: a tied tribe contest is lost by the tribe containing the lowest individual weekly scorer; tied individual weekly scores use the previous period. If still tied or missing previous scores, require commissioner resolution.

The Gauntlet always resets to two equal tribes. Previous period's top two scorers become captains by default; commissioner may override. Snake draft is the default, with alternating/manual formats available. Default chop is one per tribe, configurable to the two lowest overall. Tribe immunity is off by default. When explicitly enabled, the two chops come from the unprotected field. Optional FAAB auction for a Gauntlet idol; it recirculates after use and expires before merge.

All powers expire before merge. The merged field chops the lowest individual scorer. Final three places managers first, second, third by the championship period score, with the same individual tiebreak.

## Powers, privacy, and roster changes

One personal immunity idol is guaranteed in the draft pool. Other eligible power types and reward assignments vary randomly, within commissioner-selected allowed types. Initial catalog: personal immunity, ally immunity, player theft, tribe swap, FAAB cache. The schedule does not advertise reward weeks, winners, or types. Highest scorer can receive a private reward DM; league members need not know a reward was available. Participating commissioners cannot inspect secrets or future reward weeks.

Player-bound idols attach to randomly selected draft players. Only the current owner sees them; bench and IR count as rostered. Unused idols follow the player through theft, waivers, or enabled trades. On waivers they remain attached with no manager owner. Manager-bound weekly rewards disappear when their manager is eliminated. Used idols are consumed, and the player stays on the roster. Previously revealed information cannot be made secret again; previous owners may remember attached idols.

Every power is activated through private `@Chimmy` interactions, including entry points in Huddle, DM, and league chat. Do not broadcast command text or confirmation into those shared channels. Action powers reveal to the league upon execution. Immunity submissions stay sealed until the chop. The scheduled ceremony time is the default immunity lock even if a host starts late; commissioner can set another deadline. Player-bound powers default to before the attached player's next game locks. Steal targets must also be unlocked; stealing crosses tribal immunity, gives no compensation, and requires a valid roster drop if full.

Immunity passes the chop to the next eligible scorer and can chain across multiple managers. If there are insufficient eligible managers or an unresolved boundary tie, return a blocked resolution for the commissioner, with no partial elimination writes.

Chopped players enter league-wide FAAB waivers; budget is commissioner/league-configured. Trading defaults off. Eliminated managers retain chat, spectating, recaps, and ceremony access, while losing roster control and tribe decision rights.

## Experience

Clean fantasy dashboard with consistent island atmosphere across mobile and desktop. Home order: lineup; weekly rules and actions; tribe race and matchups; elimination danger; private powers; activity.

Commissioner chooses automatic or hosted Chop Night and may disable the suspense presentation. Ceremony sequence shows chop candidates, immunity reveals and pass-downs, final elimination, and roster release. Replay and reduced-motion final states must be supported.

## Current integration

- Draft completion seeds the hidden player-bound idol pool from drafted players that landed on rosters. Random tribe formation can initialize immediately; commissioner formation and captain voting are available through `/survivor-guillotine/[leagueId]` and its authenticated operations API.
- The commissioner calendar sets real scoring dates and ceremony times per NFL/NBA period, with explicit NBA combined/All-Star overrides. Concealed reward weeks are additive and are never returned by the member season API. Completed calendar rows are immutable. Automatic period advancement waits for the next saved start time, a completed previous ceremony, and resolved captains/tribes.
- NBA capped-game scoring uses daily starter snapshots, saves each manager's selection privately, and counts the first eligible player-games under the league's scoring rules. Lineups lock at the first scheduled NBA tip-off of the chosen Eastern day.
- The league screen is lineup first, then tribe race, live danger scores, private powers, Chop Night recaps, and commissioner controls. Hosted Chop Night uses the same finalized server-score chop path as automatic ceremonies. A commissioner tie decision is accepted only when resolution is blocked by an actual tie and is recorded in the ceremony audit.
- The optional Gauntlet idol uses sealed FAAB bids. The highest active bidder with sufficient balance wins at the saved deadline; equal bids use earliest submission. The waiver heartbeat settles due auctions before Chop Night and debits both roster balance stores atomically. The idol is private, manager-bound, and can re-enter circulation after use until the final Gauntlet period.
- Earlier-period score changes are auditable through commissioner control. Changed outcomes require explicit reconciliation across later drafts, waivers, and chops; the app does not silently cascade reversals through already-played periods. The latest completed period retains automatic stat-correction reversal before period advancement.

## Remaining production gates

- Tribe decisions support first-valid, captain, commissioner, and private majority-vote ballots. At the saved selection cutoff, the existing waiver heartbeat fills missing choices when the league chose random fallback; otherwise the commissioner resolves them. Starting tribes support commissioner assignment, random draw, balanced manager choice, and a live snake captain draft; the completed tribes elect their Week 1 captains.
- Hosted presentation currently provides a result/replay card, not a timed animated sequence. The commissioner still has to record explicit sit-outs and all cross-tribe matchups before a Match Play chop.
- The migration is checked into `prisma/migrations/20261013000000_survivor_guillotine_live`. A transactional test-database execution succeeded and rolled back. Production, staging, and test migration histories each contain previously applied migrations absent from this checkout. Reconcile that history before using the repository's guarded production deploy, then perform authenticated multi-manager QA before enabling real leagues.

Reference assets were committed separately using the user's requested commit message. Implementation is intentionally a separate change set.

## Validation

- Prisma schema validated and Prisma Client generated locally. The migration is pending against the production target.
- 65 focused Survivor Guillotine tests pass across eight files, including calendar, hidden reward persistence, balanced manager tribe choice, captain draft, random Match Play fallback, and member-view privacy checks.
- Scoped TypeScript for the touched Survivor surfaces and draft hook passes. A full repository typecheck is much larger and was not used as the gate for this isolated feature.
