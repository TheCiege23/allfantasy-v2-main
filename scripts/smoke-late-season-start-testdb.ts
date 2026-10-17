/**
 * A season drafted mid-season starts at its sport's next unplayed week — on the known test database.
 *
 * Creates native NFL and NCAAF redraft leagues through the canonical path, completes each draft with
 * hand-written picks, runs the real `syncCompletedDraftToRedraftSeason`, and checks the season against
 * the sport week the test DB's own schedule reports (`resolveSportWeek`):
 *   - `currentWeek` is the next unplayed week (or 1 before the sport starts),
 *   - no matchup exists before it, every regular week from it to the playoffs has matchups,
 *   - a re-sync does not move it.
 *
 * Before 2026-09-28 every season started at week 1 with matchups from week 1: a league drafted in
 * week 5 was scored on games played before it drafted, and then — the finalizer sweeping only three
 * weeks back — stuck at week 1 for good.
 *
 * Never accepts a production host. Every row it creates is removed.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { syncCompletedDraftToRedraftSeason } from '../lib/redraft/finalizeDraftToRedraftSeason'
import { resolveSeasonStartWeek } from '../lib/redraft/seasonStartWeek'
import { resolveSportWeek } from '../lib/season-week/seasonWeekService'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = 'latestart-' + randomUUID().slice(0, 8)
  const users: string[] = []
  const leagues: string[] = []
  const report: Record<string, unknown> = {}
  try {
    for (let i = 0; i < 4; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)

    for (const [sport, preset] of [['NFL', 'fb_half_ppr'], ['NCAAF', 'ncaaf_half_ppr']] as const) {
      const v = validateCreatePayload({ concept: 'redraft', sport, teamCount: 4, draftType: 'snake', scoringPreset: preset, leagueName: `${marker}-${sport}`, timezone: 'America/New_York', conceptSetup: {} })
      if (!v.ok) throw new Error(`${sport}_CREATION_${v.error}`)
      const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
      leagues.push(leagueId)
      await createDefaultLeagueRosterConfig(leagueId, sport, 'redraft')
      const generic = (await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }))
        .sort((a, b) => Number(b.platformUserId === users[0]) - Number(a.platformUserId === users[0]))
      for (let i = 0; i < 4; i++) {
        await prisma.leagueTeam.updateMany({ where: { leagueId, platformUserId: generic[i]!.platformUserId }, data: { platformUserId: users[i], claimedByUserId: users[i] } })
        await prisma.roster.update({ where: { id: generic[i]!.id }, data: { platformUserId: users[i] } })
      }
      const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
      const positions = ['QB', 'RB', 'WR', 'TE', 'K']
      await prisma.draftPick.createMany({
        data: Array.from({ length: draft.rounds * 4 }, (_, i) => {
          const round = Math.floor(i / 4), slot = i % 4, owner = round % 2 === 0 ? slot : 3 - slot
          return { sessionId: draft.id, overall: i + 1, round: round + 1, slot: owner + 1, rosterId: generic[owner]!.id, playerId: `${marker}-${sport}-${i}`, playerName: `P${i}`, position: positions[round % positions.length]!, sportType: sport, source: 'simulation_fixture' }
        }),
      })
      await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })

      const now = new Date()
      await syncCompletedDraftToRedraftSeason(leagueId)
      const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
      const regularEnd = Math.min(season.totalWeeks, season.playoffStartWeek - 1)
      const sportWeek = await resolveSportWeek(season.sport, season.season, { now })
      const expected = await resolveSeasonStartWeek({ sport: season.sport, seasonYear: season.season, regularSeasonEnd: regularEnd }, { now })
      const weeks = (await prisma.redraftMatchup.findMany({ where: { seasonId: season.id }, select: { week: true } })).map((m) => m.week)
      const distinct = [...new Set(weeks)].sort((a, b) => a - b)
      report[sport] = {
        sportWeekNow: sportWeek.ok ? { week: sportWeek.sportWeek, state: sportWeek.state, next: sportWeek.nextSportWeek } : sportWeek,
        expected, currentWeek: season.currentWeek, regularEnd, playoffStartWeek: season.playoffStartWeek,
        matchupWeeks: distinct.length ? `${distinct[0]}..${distinct[distinct.length - 1]} (${distinct.length} weeks)` : 'none',
      }
      check(season.currentWeek === expected.startWeek, `${sport}_CURRENT_WEEK:${season.currentWeek} expected ${expected.startWeek}`)
      check(distinct[0] === expected.startWeek, `${sport}_FIRST_MATCHUP_WEEK:${distinct[0]} expected ${expected.startWeek}`)
      check(distinct.length === regularEnd - expected.startWeek + 1 && distinct[distinct.length - 1] === regularEnd, `${sport}_MATCHUP_WEEKS:${distinct.join(',')}`)

      // Idempotent: a re-sync must not move a running season.
      await syncCompletedDraftToRedraftSeason(leagueId)
      const again = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
      check(again.currentWeek === season.currentWeek, `${sport}_RESYNC_MOVED:${again.currentWeek}`)
      check((await prisma.redraftMatchup.count({ where: { seasonId: season.id } })) === weeks.length, `${sport}_RESYNC_ADDED_MATCHUPS`)
    }
  } finally {
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    const cleanup = {
      leagues: await prisma.league.count({ where: { id: { in: leagues } } }),
      users: await prisma.appUser.count({ where: { id: { in: users } } }),
    }
    check(cleanup.leagues === 0 && cleanup.users === 0, 'CLEANUP:' + JSON.stringify(cleanup))
    console.log(JSON.stringify({ target: 'known test DB', report, cleanup }, null, 2))
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('Late season start smoke failed:', e.message); process.exitCode = 1 })
