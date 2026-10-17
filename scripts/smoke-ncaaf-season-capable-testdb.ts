/**
 * An NCAAF league is season-capable — on the known test database.
 *
 * Creates a native NCAAF redraft league through the canonical path, completes its draft with
 * hand-written picks, runs the real `syncCompletedDraftToRedraftSeason`, and then asks the three
 * runtimes that `SEASON_CAPABLE_SPORTS` gates whether they will carry the season:
 *   - the schedule runtime resolves it,
 *   - `advance_week` (the hourly roller's and the commissioner's path) reaches the week transition
 *     and is refused by the transition's own guard — the week is not played — not by the sport gate,
 *   - the playoff runtime resolves it.
 *
 * Before NCAAF joined the list all three answered `not_nfl_redraft`, which the roller files as
 * FORMAT_NOT_SUPPORTED: a permanent hold that is deliberately not counted as a failure.
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
import {
  advanceNflRedraftScheduleWeek,
  resolveNflRedraftScheduleRuntime,
} from '../lib/schedule-runtime/resolveNflRedraftScheduleRuntime'
import { resolveNflRedraftPlayoffRuntime } from '../lib/playoff-runtime/resolveNflRedraftPlayoffRuntime'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = 'ncaafcap-' + randomUUID().slice(0, 8)
  const users: string[] = []
  const leagues: string[] = []
  const report: Record<string, unknown> = {}
  try {
    for (let i = 0; i < 4; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)

    const v = validateCreatePayload({ concept: 'redraft', sport: 'NCAAF', teamCount: 4, draftType: 'snake', scoringPreset: 'ncaaf_half_ppr', leagueName: marker, timezone: 'America/New_York', conceptSetup: {} })
    if (!v.ok) throw new Error(`CREATION_${v.error}`)
    const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
    leagues.push(leagueId)
    await createDefaultLeagueRosterConfig(leagueId, 'NCAAF', 'redraft')
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
        return { sessionId: draft.id, overall: i + 1, round: round + 1, slot: owner + 1, rosterId: generic[owner]!.id, playerId: `${marker}-${i}`, playerName: `P${i}`, position: positions[round % positions.length]!, sportType: 'NCAAF', source: 'simulation_fixture' }
      }),
    })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })

    await syncCompletedDraftToRedraftSeason(leagueId)
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    const matchups = await prisma.redraftMatchup.count({ where: { seasonId: season.id } })

    const schedule = await resolveNflRedraftScheduleRuntime({ seasonId: season.id })
    const advance = await advanceNflRedraftScheduleWeek({ seasonId: season.id, action: 'advance_week', week: season.currentWeek, commissionerOverride: false })
    const playoff = await resolveNflRedraftPlayoffRuntime({ seasonId: season.id })
    const after = await prisma.redraftSeason.findFirstOrThrow({ where: { id: season.id } })

    report.season = { sport: season.sport, status: season.status, currentWeek: season.currentWeek, playoffStartWeek: season.playoffStartWeek, totalWeeks: season.totalWeeks, matchups }
    report.schedule = schedule.ok ? { ok: true } : schedule
    report.advance = advance.ok ? { ok: true, currentWeek: advance.currentWeek } : { ok: false, code: advance.code, message: advance.message }
    report.playoff = playoff.ok ? { ok: true } : playoff
    report.currentWeekAfter = after.currentWeek

    check(matchups > 0, 'NO_MATCHUPS')
    check(schedule.ok, `SCHEDULE_RUNTIME:${schedule.ok ? '' : schedule.reason}`)
    // The week is unplayed, so the transition's own guard must refuse — and nothing must move.
    check(!advance.ok, 'ADVANCE_UNEXPECTEDLY_APPLIED')
    check(!advance.ok && advance.code !== 'not_nfl_redraft', `ADVANCE_REFUSED_BY_SPORT_GATE:${advance.ok ? '' : advance.code}`)
    check(after.currentWeek === season.currentWeek, `WEEK_MOVED:${after.currentWeek}`)
    check(playoff.ok, `PLAYOFF_RUNTIME:${playoff.ok ? '' : playoff.reason}`)
  } finally {
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    const cleanup = {
      leagues: await prisma.league.count({ where: { id: { in: leagues } } }),
      users: await prisma.appUser.count({ where: { id: { in: users } } }),
    }
    console.log(JSON.stringify({ target: 'known test DB', report, cleanup }, null, 2))
    check(cleanup.leagues === 0 && cleanup.users === 0, 'CLEANUP:' + JSON.stringify(cleanup))
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('NCAAF season-capable smoke failed:', e.message); process.exitCode = 1 })
