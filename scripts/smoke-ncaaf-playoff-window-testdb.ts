/**
 * NCAAF playoffs end by week 13 — on the known test database.
 *
 * College football has full slates through week 13; week 14 is conference championships (~10 games)
 * and week 15 is Army-Navy (1 game). Owner's ruling (2026-09-28): a 4-team bracket plays weeks 12-13
 * after a regular season through week 11; a 6-team bracket plays weeks 11-13 after week 10. The old
 * defaults started playoffs at 13, so a 4-team final landed on week 14 and a 6-team one on week 15,
 * where nearly every player has no game.
 *
 * Creates native NCAAF leagues (redraft, keeper, dynasty, best ball; 4 and 12 teams) through the
 * canonical path, completes each draft with hand-written picks, runs the real draft sync, and checks
 * every place the playoff window is stored agrees: League.playoffStartWeek / playoffTeams, the
 * settings snapshot, and the RedraftSeason the season runs on — and that the last regular-season
 * matchup is the week before the playoffs and the championship is week 13.
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
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }
const LAST_FULL_WEEK = 13
const rounds = (teams: number) => Math.ceil(Math.log2(Math.max(2, teams)))

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = 'ncaafpo-' + randomUUID().slice(0, 8)
  const users: string[] = []
  const leagues: string[] = []
  const report: Record<string, unknown> = {}
  const problems: string[] = []
  try {
    for (let i = 0; i < 12; i++) users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)

    for (const concept of ['redraft', 'keeper', 'dynasty', 'best_ball']) {
      for (const teamCount of [4, 12]) {
        const key = `${concept}-${teamCount}`
        const v = validateCreatePayload({ concept, sport: 'NCAAF', teamCount, draftType: 'snake', scoringPreset: 'ncaaf_half_ppr', leagueName: `${marker}-${key}`, timezone: 'America/Chicago', conceptSetup: {} })
        if (!v.ok) { report[key] = { creationRefused: v.error }; continue }
        const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
        leagues.push(leagueId)
        const created = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { leagueType: true } })
        await createDefaultLeagueRosterConfig(leagueId, 'NCAAF', String(created.leagueType ?? concept))

        // The commissioner's roster first: it already belongs to users[0].
        const generic = (await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }))
          .sort((a, b) => Number(b.platformUserId === users[0]) - Number(a.platformUserId === users[0]))
        for (let i = 0; i < generic.length; i++) {
          await prisma.leagueTeam.updateMany({ where: { leagueId, platformUserId: generic[i]!.platformUserId }, data: { platformUserId: users[i], claimedByUserId: users[i] } })
          await prisma.roster.update({ where: { id: generic[i]!.id }, data: { platformUserId: users[i] } })
        }
        const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
        const n = generic.length
        await prisma.draftPick.createMany({
          data: Array.from({ length: draft.rounds * n }, (_, i) => {
            const round = Math.floor(i / n), slot = i % n, owner = round % 2 === 0 ? slot : n - 1 - slot
            return { sessionId: draft.id, overall: i + 1, round: round + 1, slot: owner + 1, rosterId: generic[owner]!.id, playerId: `${marker}-${key}-${i}`, playerName: `P${i}`, position: ['QB', 'RB', 'WR', 'TE', 'K'][round % 5]!, sportType: 'NCAAF', source: 'simulation_fixture' }
          }),
        })
        await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })
        await syncCompletedDraftToRedraftSeason(leagueId)

        const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { playoffStartWeek: true, playoffTeams: true, settings: true } })
        const settings = (league.settings ?? {}) as Record<string, unknown>
        const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
        const matchupWeeks = (await prisma.redraftMatchup.findMany({ where: { seasonId: season.id }, select: { week: true } })).map((m) => m.week)
        const lastRegular = matchupWeeks.length ? Math.max(...matchupWeeks) : null
        const teams = Number(league.playoffTeams ?? settings.playoff_team_count ?? 0)
        const expectedStart = LAST_FULL_WEEK - rounds(teams) + 1
        const settingsStart = settings.playoff_start_week ?? null
        report[key] = {
          playoffTeams: teams, leaguePlayoffStart: league.playoffStartWeek, settingsPlayoffStart: settingsStart,
          seasonPlayoffStart: season.playoffStartWeek, seasonTotalWeeks: season.totalWeeks, lastRegularMatchupWeek: lastRegular,
          championshipWeek: season.playoffStartWeek + rounds(teams) - 1, expectedStart,
        }
        const bad = [
          league.playoffStartWeek !== expectedStart ? `league.playoffStartWeek=${league.playoffStartWeek}` : '',
          settingsStart != null && Number(settingsStart) !== expectedStart ? `settings.playoff_start_week=${settingsStart}` : '',
          season.playoffStartWeek !== expectedStart ? `season.playoffStartWeek=${season.playoffStartWeek}` : '',
          season.playoffStartWeek + rounds(teams) - 1 > LAST_FULL_WEEK ? `championship=${season.playoffStartWeek + rounds(teams) - 1}` : '',
          lastRegular != null && lastRegular !== expectedStart - 1 ? `lastRegularMatchup=${lastRegular}` : '',
        ].filter(Boolean)
        if (bad.length) problems.push(`${key}: ${bad.join(', ')} (expected start ${expectedStart})`)
      }
    }
    report.problems = problems
    check(problems.length === 0, 'NCAAF_PLAYOFF_WINDOW:\n  ' + problems.join('\n  '))
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
main().catch((e) => { console.error('NCAAF playoff window smoke failed:', e.message); process.exitCode = 1 })
