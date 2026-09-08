/**
 * @vitest-environment node
 *
 * ⚠ THE NODE ENVIRONMENT IS LOAD-BEARING, NOT A PREFERENCE. `lib/prisma.ts`
 * returns `null` when `typeof window !== 'undefined'` — a deliberate guard so a
 * client bundle cannot hold a database client. The repo's default vitest
 * environment is jsdom, which defines `window`, so without this directive
 * `prisma` is null and every query here dies on a property read of null rather
 * than on anything to do with the lifecycle.
 */
/**
 * One league, the WHOLE lifecycle, against a real database.
 *
 * create -> draft finalize -> regular season -> playoffs -> champion ->
 * season archive -> offseason, with the scheduled roller doing the driving.
 *
 * 🛑 WHY A DB TEST WHEN EVERY PIECE IS UNIT-TESTED. Because the pieces were
 * never the problem. Measured 2026-09-07: production holds ZERO playoff
 * brackets, ZERO championships and ZERO season archives, and all 246 seasons
 * sit at `currentWeek = 1` — not because an engine is wrong, but because the
 * handoffs between them had no caller. A handoff that never fires cannot be
 * caught by a suite that mocks its neighbours; it fails silently by
 * construction. This is the only shape of test that can see it.
 *
 * ⚠ IT DRIVES OFF THE REAL NFL SCHEDULE BY MOVING THE CLOCK. `rollSeasonWeeks`
 * takes `now` as an injectable dependency, so a season is walked in seconds by
 * advancing a Date past each week's real last kickoff, read from `SportsGame`.
 * That exercises the ACTUAL resolver against the ACTUAL schedule rather than a
 * fixture — the one thing the unit suites cannot do.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT TEST: SCORING. Matchups are marked final
 * with synthetic scores rather than seeding 12 rosters x 14 weeks of stat lines.
 * The scoring engine has its own suite. This is about lifecycle transitions,
 * which is where the dead ends were. Said out loud so a green run here is never
 * read as "scoring is verified".
 *
 * ── RUNNING IT ───────────────────────────────────────────────────────────────
 *
 *   DATABASE_URL='postgresql://…' SEASON_RUN_DATABASE_URL='postgresql://…' \
 *     npx vitest run __tests__/season-week/season-lifecycle-e2e.test.ts
 *
 * 🛑 IT SKIPS UNLESS `SEASON_RUN_DATABASE_URL` NAMES A TARGET, AND REFUSES IF
 * THAT TARGET IS PRODUCTION. Both halves are load-bearing. This repo's other DB
 * suites gate on a flag — `RUN_EVENT_DB_IT`, `COMMISH_DB_SPECS` — and a flag
 * gates WHETHER a suite runs, never WHAT IT CONNECTS TO. Importing Prisma alone
 * populates `process.env` from `.env`, which points at production, so "no URL"
 * does not mean "no database" here; it means production. Naming the target is
 * the opt-in, and unlike a flag it cannot be set once in a shell profile and
 * forgotten.
 *
 * Skipped rather than failed, so it still appears in the run summary — a red
 * suite nobody can run is how a check stops being read.
 */
import { afterAll, describe, expect, it } from 'vitest'

/** Production compute endpoint markers. A target matching these is refused. */
const PRODUCTION_ENDPOINT_MARKERS = ['ep-curly-block', 'icy-field']

const TARGET = process.env.SEASON_RUN_DATABASE_URL?.trim() ?? ''

function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return ''
  }
}

const TARGET_HOST = hostOf(TARGET)
const TARGET_IS_PROD = PRODUCTION_ENDPOINT_MARKERS.some((m) => TARGET_HOST.includes(m))
const ENABLED = TARGET.length > 0 && !TARGET_IS_PROD

const SEASON = 2026

describe.skipIf(!ENABLED)('season lifecycle, end to end, against a real database', () => {
  let leagueId: string | null = null
  let prismaRef: typeof import('@/lib/prisma').prisma | null = null

  afterAll(async () => {
    if (prismaRef && leagueId && process.env.SEASON_RUN_KEEP !== '1') {
      // One delete: League cascades the season, rosters, matchups, bracket and
      // archive rows this test created.
      await prismaRef.league.delete({ where: { id: leagueId } }).catch(() => {})
    }
    await prismaRef?.$disconnect().catch(() => {})
  })

  it(
    'drives create -> season -> playoffs -> champion -> offseason with no manual step',
    async () => {
      // The target must be pinned before anything can import Prisma.
      process.env.DATABASE_URL = TARGET
      process.env.DIRECT_URL = TARGET

      const { prisma } = await import('@/lib/prisma')
      prismaRef = prisma
      const { validateCreatePayload } = await import(
        '@/lib/league-creation/canonical/validateCreateLeague'
      )
      const { executeCanonicalLeagueCreation } = await import(
        '@/lib/league-creation/canonical/executeCanonicalLeagueCreation'
      )
      const { syncCompletedDraftToRedraftSeason } = await import(
        '@/lib/redraft/finalizeDraftToRedraftSeason'
      )
      const { rollSeasonWeeks, rollPostseason } = await import('@/lib/season-week/rollSeasonWeek')
      const { generateSchedule } = await import('@/lib/redraft/scheduleEngine')

      const mark = `SLR-${Date.now()}`
      const email = `${mark}@season-lifecycle-run.invalid`

      // `username` is required and unique on AppUser; `name` is not a field.
      const user = await prisma.appUser.create({
        data: { email, username: mark, displayName: 'Season Run Commissioner' },
        select: { id: true },
      })

      // ── 1. create through the REAL canonical pipeline ─────────────────────
      const validated = validateCreatePayload({
        concept: 'redraft',
        sport: 'NFL',
        scoringPreset: 'PPR',
        teamCount: 12,
        draftType: 'snake',
        leagueName: `Season Lifecycle Run ${mark.slice(-6)}`,
      })
      expect(validated.ok, `create payload rejected: ${JSON.stringify(validated).slice(0, 200)}`).toBe(true)
      if (!validated.ok) return

      const created = await executeCanonicalLeagueCreation({
        appUserId: user.id,
        body: validated.data,
      })
      if (!created.ok) {
        // Carry `detail`, not just `error` — `error` is the fixed string
        // "Failed to create league"; `detail` holds the real Prisma diagnostic.
        const detail = (created.response as { detail?: unknown }).detail
        throw new Error(
          `canonical create failed: ${created.response.error}${typeof detail === 'string' ? ` — ${detail}` : ''}`,
        )
      }
      leagueId = created.response.league.id
      expect(leagueId, 'canonical creation returned no leagueId').toBeTruthy()
      if (!leagueId) return

      // The season year must be the REAL one, or the resolver has no schedule.
      await prisma.league.update({ where: { id: leagueId }, data: { season: SEASON } })

      // ── 2. finalize the draft: season + rosters + schedule ────────────────
      await prisma.draftSession.updateMany({ where: { leagueId }, data: { status: 'completed' } })
      const sync = await syncCompletedDraftToRedraftSeason(leagueId)
      expect(sync.skipped, `redraft sync skipped: ${sync.reason}`).toBe(false)
      const seasonId = sync.seasonId!
      await prisma.redraftSeason.update({ where: { id: seasonId }, data: { season: SEASON } })

      const season = await prisma.redraftSeason.findUniqueOrThrow({
        where: { id: seasonId },
        select: { totalWeeks: true, playoffStartWeek: true, sport: true, medianGame: true },
      })
      const regularEnd = Math.min(season.totalWeeks, Math.max(1, season.playoffStartWeek - 1))

      /*
       * ⚠ ROSTERS ARE SEEDED DIRECTLY, AND THE DRAFT IS NOT UNDER TEST HERE.
       * `syncCompletedDraftToRedraftSeason` builds RedraftRosters from draft
       * PICKS, and `ensureScheduleForNewSeason` then returns early on
       * `rosters.length < 2` — so a session marked complete with no picks yields
       * no rosters and no schedule. Seeding a full 12-team board is a different
       * test; this one starts from "a drafted league" and proves what happens
       * AFTER, which is where every dead end was. The schedule still comes from
       * `generateSchedule`, the same engine the app calls, rather than a
       * hand-built fixture.
       */
      let rosters = await prisma.redraftRoster.findMany({
        where: { seasonId },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
      if (rosters.length < 2) {
        const teams = await prisma.leagueTeam.findMany({
          where: { leagueId },
          select: { id: true, teamName: true, ownerName: true, claimedByUserId: true },
          orderBy: { id: 'asc' },
        })
        for (const t of teams) {
          await prisma.redraftRoster.create({
            data: {
              seasonId,
              leagueId,
              ownerId: t.claimedByUserId ?? t.id,
              ownerName: t.ownerName ?? 'Manager',
              teamName: t.teamName ?? 'Team',
            },
          })
        }
        rosters = await prisma.redraftRoster.findMany({
          where: { seasonId },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      }
      expect(rosters.length, 'need at least 2 rosters to schedule').toBeGreaterThan(1)

      /*
       * ⚠ EVERY ROSTER NEEDS AT LEAST ONE PLAYER OR THE SCHEDULE RUNTIME REFUSES.
       * `advanceNflRedraftScheduleWeek` computes `rosterReady` as
       * `teamsWithPlayers === teams`, where a team counts only if
       * `totalRosterSize > 0`. An empty roster is not a scheduling detail to it —
       * it means the league is not ready to play, which is the correct rule and
       * exactly what it reported (`RUNTIME_REFUSED(ROSTER_NOT_READY)`) before
       * this existed.
       */
      for (const r of rosters) {
        const existing = await prisma.redraftRosterPlayer.count({ where: { rosterId: r.id } })
        if (existing > 0) continue
        await prisma.redraftRosterPlayer.create({
          data: {
            rosterId: r.id,
            playerId: `slr:qb:${r.id.slice(-8)}`,
            playerName: 'Lifecycle Run QB',
            position: 'QB',
            sport: 'NFL',
            slotType: 'QB',
          },
        })
      }

      /*
       * ⚠ AND `rosterReady` READS THE GENERIC `Roster`, NOT `RedraftRoster` —
       * A DISTINCTION THAT COST TWO FAILED RUNS. `resolveNflRedraftRosterRuntime`
       * queries `prisma.roster` and derives `totalRosterSize` from its
       * `playerData` JSON, so filling `RedraftRosterPlayer` (above, which the
       * SCORING side reads) leaves the SCHEDULE side still seeing empty teams.
       * Two roster representations, two consumers, and only the second one gates
       * the week transition.
       */
      const genericRosters = await prisma.roster.findMany({
        where: { leagueId },
        select: { id: true, playerData: true },
      })
      for (const gr of genericRosters) {
        const pd = gr.playerData as { players?: unknown[] } | null
        if (pd && Array.isArray(pd.players) && pd.players.length > 0) continue
        const pid = `slr:qb:${gr.id.slice(-8)}`
        await prisma.roster.update({
          where: { id: gr.id },
          data: {
            playerData: {
              players: [{ playerId: pid, playerName: 'Lifecycle Run QB', position: 'QB' }],
              starters: [pid],
            },
          },
        })
      }

      if ((await prisma.redraftMatchup.count({ where: { seasonId } })) === 0) {
        const slots = generateSchedule(
          rosters,
          season.totalWeeks,
          season.playoffStartWeek,
          season.sport,
          { medianGame: season.medianGame },
        )
        for (const slot of slots) {
          if (slot.type === 'median' || !slot.away) continue
          await prisma.redraftMatchup.create({
            data: {
              seasonId,
              leagueId,
              week: slot.week,
              type: 'regular',
              homeRosterId: slot.home,
              awayRosterId: slot.away,
              isMedianMatchup: false,
            },
          })
        }
      }

      const matchupCount = await prisma.redraftMatchup.count({ where: { seasonId } })
      expect(matchupCount, 'no schedule generated — nothing to drive').toBeGreaterThan(0)

      // ── 3. real kickoff times drive `now` ─────────────────────────────────
      const slate = await prisma.sportsGame.findMany({
        where: { sport: 'NFL', season: SEASON, seasonType: 'regular' },
        select: { week: true, startTime: true },
      })
      const lastKickoff = new Map<number, Date>()
      for (const g of slate) {
        if (g.week == null || !g.startTime) continue
        const cur = lastKickoff.get(g.week)
        if (!cur || g.startTime > cur) lastKickoff.set(g.week, g.startTime)
      }
      expect(lastKickoff.size, 'no NFL 2026 schedule rows — the resolver cannot place a week').toBeGreaterThan(0)

      /*
       * ⚠ THE REAL 2026 SEASON HAS NOT BEEN PLAYED, SO ITS GAMES MUST BE MARKED
       * FINAL FOR A SEASON RUN TO BE POSSIBLE AT ALL. Week 1 kicks off
       * 2026-09-10 and every `SportsGame` row is still `scheduled`, so
       * `allFinal` is false and the resolver correctly reports `between` — "the
       * week is not over" — forever. That is the guard working, not a bug: it is
       * precisely what stops a roller advancing a league over games nobody has
       * played. Simulating a PLAYED season therefore means simulating played
       * games.
       *
       * 🛑 THIS WRITES TO A GLOBAL TABLE, WHICH IS WHY THIS SUITE DEMANDS A
       * DISPOSABLE BRANCH AND REFUSES PRODUCTION. `SportsGame` is not
       * league-scoped, so unlike everything else here it is NOT undone by
       * deleting the league. Run it against a branch you are willing to throw
       * away.
       */
      await prisma.sportsGame.updateMany({
        where: {
          sport: 'NFL',
          season: SEASON,
          seasonType: 'regular',
          week: { lte: regularEnd },
        },
        data: { status: 'final' },
      })

      // ── 4. walk the regular season ────────────────────────────────────────
      const { resolveSeasonWeekForRedraftSeason } = await import('@/lib/season-week')
      // A roller that declines is the normal case, so the trace has to say WHICH
      // decline — "did not advance" alone cannot tell an unresolved week from a
      // refused transition from a league the scope never selected.
      const trace: string[] = []
      for (let week = 1; week <= regularEnd; week += 1) {
        await prisma.redraftMatchup.updateMany({
          where: { seasonId, week },
          data: { status: 'final', homeScore: 100 + week, awayScore: 90 + week },
        })
        const kick = lastKickoff.get(week)
        // 4h past the week's last kickoff: every game has started and the slate
        // reads `played`, which is exactly what the roller waits for.
        const now = kick ? new Date(kick.getTime() + 4 * 60 * 60 * 1000) : new Date()
        const resolved = await resolveSeasonWeekForRedraftSeason(seasonId, { now })
        const out = await rollSeasonWeeks({ now, limit: 50 })
        const mine = out.outcomes.find((o) => o.seasonId === seasonId)
        trace.push(
          `w${week}: resolver=${resolved.ok ? `${resolved.phase}/${resolved.state}/w${resolved.fantasyWeek}` : resolved.reason}` +
            ` considered=${out.considered} adv=${out.advanced}` +
            ` plan=${mine ? (mine.plan.action === 'hold' ? `hold:${mine.plan.reason}${mine.plan.detail ? `(${mine.plan.detail})` : ''}` : 'advance') : 'NOT-IN-SCOPE'}`,
        )
      }

      const afterRegular = await prisma.redraftSeason.findUniqueOrThrow({
        where: { id: seasonId },
        select: { currentWeek: true, status: true },
      })
      /*
       * ⚠ `regular_season_complete` IS TRANSIENT, AND ASSERTING IT EXACTLY WAS
       * WRONG. Advancing past the final week sets that status AND
       * auto-generates the bracket in the same call; generating the bracket then
       * moves the season straight to `playoffs`. Measured here: the run lands on
       * `playoffs` at week 15, never resting on `regular_season_complete`. The
       * real claim is "the regular season is over", so that is what is asserted.
       */
      expect(
        ['regular_season_complete', 'playoffs', 'complete'],
        `regular season did not complete (stuck at week ${afterRegular.currentWeek}, status ${afterRegular.status}). ` +
          trace.slice(0, 4).join(' | '),
      ).toContain(afterRegular.status)

      // ── 5. the bracket auto-generates on that transition ──────────────────
      const bracket = await prisma.redraftPlayoffBracket.findFirst({ where: { seasonId } })
      expect(bracket, 'no playoff bracket was auto-generated').toBeTruthy()

      // ── 6. walk the postseason ────────────────────────────────────────────
      const postTrace: string[] = []
      for (let pass = 1; pass <= 8; pass += 1) {
        await prisma.redraftPlayoffMatchup.updateMany({
          where: { seasonId, status: { not: 'final' } },
          data: { homeScore: 120, awayScore: 100 },
        })
        const post = await rollPostseason({ limit: 50 })
        const mine = post.outcomes.find((o) => o.seasonId === seasonId)
        const s = await prisma.redraftSeason.findUniqueOrThrow({
          where: { id: seasonId },
          select: { status: true },
        })
        postTrace.push(
          `p${pass}: step=${mine?.step ?? 'NOT-IN-SCOPE'}${mine?.detail ? `(${mine.detail})` : ''}` +
            ` offseasonEntered=${mine?.offseasonEntered ?? '-'} season=${s.status}`,
        )
        if (post.finalized > 0 || s.status === 'complete') break
        if (post.advanced === 0 && post.generated === 0) break
      }

      // ── 7. the end state the whole chain exists to produce ────────────────
      const finalSeason = await prisma.redraftSeason.findUniqueOrThrow({
        where: { id: seasonId },
        select: { status: true },
      })
      const league = await prisma.league.findUniqueOrThrow({
        where: { id: leagueId },
        select: { lifecycleState: true },
      })
      const archive = await prisma.leagueSeason.findFirst({ where: { leagueId } })
      const franchiseRows = await prisma.franchiseSeason.count({ where: { leagueId } })
      const championships = await prisma.leagueChampionship.count({ where: { leagueId } })

      expect(finalSeason.status, 'season never reached complete').toBe('complete')
      expect(
        league.lifecycleState,
        `league never entered offseason. ${postTrace.join(' | ')}`,
      ).toBe('offseason')
      expect(archive, 'no LeagueSeason archive row was written').toBeTruthy()
      expect(franchiseRows, 'no FranchiseSeason rows — career rank would score zero').toBeGreaterThan(0)
      expect(championships, 'no champion was crowned').toBeGreaterThan(0)
    },
    15 * 60_000,
  )
})

describe('season lifecycle e2e — guard', () => {
  it('refuses a production target even when one is named', () => {
    // 🛑 THE HALF THAT MUST NOT REGRESS. A flag gates whether a suite runs; it
    // never gates what it connects to. This asserts the refusal itself, so the
    // guard is exercised on every ordinary run — including the ones where the
    // suite above is skipped and nothing else here executes.
    for (const host of [
      'ep-curly-block-ad0dlt9o-pooler.c-2.us-east-1.aws.neon.tech',
      'icy-field-51189449.example',
    ]) {
      expect(PRODUCTION_ENDPOINT_MARKERS.some((m) => host.includes(m))).toBe(true)
    }
    expect(PRODUCTION_ENDPOINT_MARKERS.some((m) => 'ep-long-sun-adl6g8jn-pooler.c-2.us-east-1.aws.neon.tech'.includes(m))).toBe(false)
  })
})
