/**
 * A native guillotine season, end to end on the known test database: chop to one survivor, then
 * crown, archive, enter the offseason, open year two, and start every team alive again.
 *
 * Never accepts a production database host. Run with DATABASE_URL naming the test DB and the
 * shared Redis variables explicitly empty (see simulate-four-team-season-testdb.ts).
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { validateCreatePayload } from '../lib/league-creation/canonical/validateCreateLeague'
import { runPresetEngine } from '../lib/league-creation/preset-engine/runPresetEngine'
import { createCanonicalLeagueInTransaction } from '../lib/league-creation/canonical/createCanonicalLeagueInTransaction'
import { createDefaultLeagueRosterConfig } from '../lib/roster-engine/UnifiedRosterConfigService'
import { applyDefaultNflScoringOnCreate } from '../lib/nfl-scoring'
import { syncCompletedDraftToRedraftSeason } from '../lib/redraft/finalizeDraftToRedraftSeason'
import { ensureGuillotineSeason } from '../lib/guillotine/ensureGuillotineSeason'
import { runElimination } from '../lib/guillotine/GuillotineEliminationEngine'
import { finishGuillotineSeason } from '../lib/guillotine/finishGuillotineSeason'
import { createNextLeagueDraft } from '../lib/live-draft-engine/createNextLeagueDraft'
import { configureEventInfrastructure, InMemoryOutboxStore } from '../lib/events'

const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label) }

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? '').hostname
  check(host.startsWith('ep-muddy-leaf-') && host.endsWith('.neon.tech'), 'KNOWN_TEST_DATABASE_REQUIRED')
  check(!process.env.UPSTASH_REDIS_REST_URL && !process.env.UPSTASH_REDIS_REST_TOKEN, 'SHARED_REDIS_MUST_BE_DISABLED')
  configureEventInfrastructure({ outboxStore: new InMemoryOutboxStore() })

  const marker = 'gseason-' + randomUUID().slice(0, 8)
  const users: string[] = []
  const leagues: string[] = []
  const report: Record<string, unknown> = {}
  try {
    for (let i = 0; i < 4; i++) {
      users.push((await prisma.appUser.create({ data: { username: `${marker}-${i}`, email: `${marker}-${i}@example.invalid` } })).id)
    }
    const v = validateCreatePayload({ concept: 'guillotine', sport: 'NFL', teamCount: 4, draftType: 'snake', scoringPreset: 'fb_ppr', leagueName: marker, timezone: 'America/Chicago', conceptSetup: {} })
    if (!v.ok) throw new Error('CREATION_' + v.error)
    const leagueId = (await prisma.$transaction((tx) => createCanonicalLeagueInTransaction(tx, users[0]!, v.data, runPresetEngine({ ...v.data, commissionerId: users[0]! })), { timeout: 120000 })).leagueId
    leagues.push(leagueId)
    await createDefaultLeagueRosterConfig(leagueId, 'NFL', 'guillotine')
    await applyDefaultNflScoringOnCreate(leagueId, 'af_ppr')

    const generic = (await prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' } }))
      .sort((a, b) => Number(b.platformUserId === users[0]) - Number(a.platformUserId === users[0]))
    for (let i = 0; i < 4; i++) {
      await prisma.leagueTeam.updateMany({ where: { leagueId, platformUserId: generic[i]!.platformUserId }, data: { platformUserId: users[i], claimedByUserId: users[i], teamName: `Team ${i}` } })
      await prisma.roster.update({ where: { id: generic[i]!.id }, data: { platformUserId: users[i] } })
    }
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId } })
    const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'K', 'DEF', 'QB', 'RB', 'WR', 'TE', 'RB', 'WR', 'WR', 'RB', 'TE']
    const picks = Array.from({ length: draft.rounds * 4 }, (_, i) => {
      const round = Math.floor(i / 4), slot = i % 4, owner = round % 2 === 0 ? slot : 3 - slot
      const playerId = `${marker}-p-${i}`
      return { sessionId: draft.id, overall: i + 1, round: round + 1, slot: owner + 1, rosterId: generic[owner]!.id, playerId, playerName: playerId, position: positions[round % positions.length]!, sportType: 'NFL', source: 'simulation_fixture' }
    })
    await prisma.draftPick.createMany({ data: picks })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { status: 'completed' } })
    await syncCompletedDraftToRedraftSeason(leagueId)

    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId } })
    const shell = await ensureGuillotineSeason({ leagueId, redraftSeasonId: season.id })
    if (!shell.ok) throw new Error(shell.reason)
    await prisma.guillotineLeagueConfig.update({ where: { leagueId }, data: { eliminationStartWeek: 1, eliminationEndWeek: 3, correctionWindow: 'immediate', rosterReleaseTiming: 'immediate', teamsPerChop: 1 } })
    for (let i = 0; i < 4; i++) {
      const own = picks.filter((p) => p.rosterId === generic[i]!.id).map((p) => p.playerId)
      await prisma.roster.update({ where: { id: generic[i]!.id }, data: { playerData: { players: own, starters: [own[0]], lineup_sections: { starters: [own[0]] } } } })
    }

    // Team i scores 10(i+1)+week: team 0 is chopped week 1, team 1 week 2, team 2 week 3, team 3 survives.
    for (let week = 1; week <= 3; week++) {
      await prisma.guillotinePeriodScore.createMany({ data: generic.map((r, i) => ({ leagueId, rosterId: r.id, weekOrPeriod: week, season: season.season, periodPoints: 10 * (i + 1) + week, seasonPointsCumul: (10 * (i + 1) + week) * week })) })
      const chop = await runElimination({ leagueId, weekOrPeriod: week, season: season.season, periodEndedAt: new Date(0), skipChat: true })
      check(chop?.choppedRosterIds.length === 1 && chop.choppedRosterIds[0] === generic[week - 1]!.id, 'CHOP_ORDER_' + week)
    }
    const survivors = await prisma.redraftRoster.findMany({ where: { seasonId: season.id, isEliminated: false } })
    check(survivors.length === 1, 'ONE_SURVIVOR')

    // ── The change under test ─────────────────────────────────────────────────────────────────
    const lifecycleBefore = (await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { lifecycleState: true } })).lifecycleState
    report.lifecycleBeforeFinish = lifecycleBefore
    const finished = await finishGuillotineSeason({ seasonId: season.id, guillotineSeasonId: shell.seasonId })
    check(finished.archived, 'ARCHIVED:' + finished.reason)
    check(finished.championRosterId === survivors[0]!.id, 'CHAMPION_IS_LAST_STANDING')

    const championship = await prisma.leagueChampionship.findUniqueOrThrow({ where: { leagueId_season: { leagueId, season: season.season } } })
    check(championship.championUserId === users[3], 'CHAMPIONSHIP_OWNER')
    const archive = await prisma.leagueSeason.findUniqueOrThrow({ where: { leagueId_season: { leagueId, season: season.season } } })
    const franchise = await prisma.franchiseSeason.findMany({ where: { leagueId, season: season.season }, orderBy: { finalRank: 'asc' } })
    const rosterOwner = new Map((await prisma.redraftRoster.findMany({ where: { seasonId: season.id } })).map((r) => [r.id, r.ownerId]))
    const rankedOwners = franchise.map((f) => rosterOwner.get(f.rosterId))
    check(JSON.stringify(rankedOwners) === JSON.stringify([users[3], users[2], users[1], users[0]]), 'FINISH_BY_SURVIVAL:' + JSON.stringify(rankedOwners))
    check(franchise.filter((f) => f.wonChampionship).length === 1 && franchise[0]!.wonChampionship, 'ONE_TITLE')
    check(archive.regularSeasonWinnerName == null, 'NO_REGULAR_SEASON_WINNER')
    const leagueAfter = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { lifecycleState: true } })
    check(leagueAfter.lifecycleState === 'offseason', 'OFFSEASON:' + leagueAfter.lifecycleState)
    const gAfter = await prisma.guillotineSeason.findUniqueOrThrow({ where: { id: shell.seasonId } })
    const seasonAfter = await prisma.redraftSeason.findUniqueOrThrow({ where: { id: season.id } })
    check(gAfter.status === 'complete' && seasonAfter.status === 'complete', 'BOTH_COMPLETE')

    // Re-run: idempotent — same champion, one championship row, one archive.
    const again = await finishGuillotineSeason({ seasonId: season.id, guillotineSeasonId: shell.seasonId })
    check(again.archived && again.championRosterId === finished.championRosterId, 'RERUN_IDEMPOTENT')
    check(await prisma.leagueChampionship.count({ where: { leagueId } }) === 1 && await prisma.leagueSeason.count({ where: { leagueId } }) === 1, 'RERUN_NO_DUPLICATES')

    // ── Year two ──────────────────────────────────────────────────────────────────────────────
    const choppedBefore = await prisma.guillotineRosterState.count({ where: { leagueId, choppedAt: { not: null } } })
    const eliminationsBefore = await prisma.guillotineElimination.count({ where: { leagueId } })
    const renewal = await createNextLeagueDraft(leagueId, users[0]!)
    check(renewal.ok, 'RENEWAL:' + JSON.stringify(renewal))
    const next = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId, season: season.season + 1 } })
    const nextRosters = await prisma.redraftRoster.findMany({ where: { seasonId: next.id } })
    check(nextRosters.length === 4 && nextRosters.every((r) => !r.isEliminated), 'YEAR_TWO_ROSTERS_ALIVE')
    const shell2 = await ensureGuillotineSeason({ leagueId, redraftSeasonId: next.id })
    check(shell2.ok && shell2.created && shell2.seasonId !== shell.seasonId, 'YEAR_TWO_SHELL')
    const choppedAfter = await prisma.guillotineRosterState.count({ where: { leagueId, choppedAt: { not: null } } })
    check(choppedAfter === 0, 'YEAR_TWO_ALL_ALIVE:' + choppedAfter)
    check(await prisma.guillotineElimination.count({ where: { leagueId } }) === eliminationsBefore, 'YEAR_ONE_HISTORY_KEPT')

    // The old season, re-offered after the league has moved on, must not pull it back.
    const stale = await finishGuillotineSeason({ seasonId: season.id, guillotineSeasonId: shell.seasonId })
    check(!stale.archived && stale.reason === 'newer_season_exists', 'STALE_REOFFER_REFUSED')

    Object.assign(report, {
      chopOrderVerified: 3,
      championIsLastStanding: true,
      finishBySurvival: true,
      lifecycle: leagueAfter.lifecycleState,
      rerunIdempotent: true,
      yearTwo: { draftCreated: true, rosters: nextRosters.length, choppedBefore, choppedAfter, eliminationsKept: eliminationsBefore },
      staleReofferRefused: true,
    })
  } finally {
    await prisma.guillotinePeriodScore.deleteMany({ where: { leagueId: { in: leagues } } })
    await prisma.guillotineEventLog.deleteMany({ where: { leagueId: { in: leagues } } })
    await prisma.guillotineRosterState.deleteMany({ where: { leagueId: { in: leagues } } })
    await prisma.automationLock.deleteMany({ where: { lockKey: { in: leagues.flatMap((id) => [1, 2, 3].map((w) => `guillotine-elimination:${id}:${w}`)) } } })
    await prisma.league.deleteMany({ where: { id: { in: leagues } } })
    await prisma.appUser.deleteMany({ where: { id: { in: users } } })
    const cleanup = {
      guillotineEvents: await prisma.guillotineEventLog.count({ where: { leagueId: { in: leagues } } }),
      guillotineStates: await prisma.guillotineRosterState.count({ where: { leagueId: { in: leagues } } }),
      championships: await prisma.leagueChampionship.count({ where: { leagueId: { in: leagues } } }),
      archives: await prisma.leagueSeason.count({ where: { leagueId: { in: leagues } } }),
      franchiseSeasons: await prisma.franchiseSeason.count({ where: { leagueId: { in: leagues } } }),
      leagues: await prisma.league.count({ where: { id: { in: leagues } } }),
      users: await prisma.appUser.count({ where: { id: { in: users } } }),
    }
    check(Object.values(cleanup).every((n) => n === 0), 'CLEANUP:' + JSON.stringify(cleanup))
    console.log(JSON.stringify({ target: 'known test DB', report, cleanup }, null, 2))
    await prisma.$disconnect()
  }
}
main().catch((e) => { console.error('Guillotine season-end smoke failed:', e.code ?? e.message); process.exitCode = 1 })
