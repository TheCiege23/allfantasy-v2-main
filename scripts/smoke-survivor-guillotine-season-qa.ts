/** Synthetic 22-manager NFL/NBA season on an explicitly named disposable Neon branch. */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { defaultSGConfig, buildSGSchedule } from '../lib/survivor-guillotine/config'
import { identifyTarget } from './db-target-identity.cjs'

const endpoint = (process.env.DATABASE_URL ?? '').match(/@([^/]+)/)?.[1]?.split('.')[0]?.replace(/-pooler$/, '')
if (!process.env.SG_QA_ENDPOINT || endpoint !== process.env.SG_QA_ENDPOINT ||
    identifyTarget(process.env.DATABASE_URL ?? '').kind === 'production') {
  throw new Error('An explicitly named nonproduction Neon branch is required.')
}
const base = 'http://127.0.0.1:3249'
const sport = process.env.SG_QA_SPORT === 'NBA' ? 'NBA' : 'NFL'
const playersPerRoster = sport === 'NBA' ? 1 : 9
const marker = `sg-season-${randomUUID()}`
const password = randomUUID() + randomUUID()
const userIds: string[] = []
let leagueId: string | null = null
type Requester = (path: string, init?: RequestInit) => Promise<Response>
function browser(): Requester {
  const cookies = new Map<string, string>()
  return async (path, init = {}) => {
    const response = await fetch(base + path, { ...init, redirect: 'manual', signal: AbortSignal.timeout(180_000),
      headers: { ...Object.fromEntries(new Headers(init.headers)),
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=')
      cookies.set(key, value)
    }
    return response
  }
}
async function post(request: Requester, path: string, body: unknown, method = 'POST') {
  const response = await request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const raw = await response.text()
  let result: Record<string, unknown>
  try { result = JSON.parse(raw) as Record<string, unknown> }
  catch { throw new Error(`${method} ${path}: ${response.status} non-JSON response ${raw.slice(0, 200)}`) }
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${String(result.error ?? '').slice(0, 300)}`)
  return result
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
async function main() {
  try {
    const user = await prisma.appUser.create({ data: { username: `${marker}-0`,
      email: `${marker}-0@example.invalid`, emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 6) } })
    userIds.push(user.id)
    const commissioner = browser()
    const csrf = await (await commissioner('/api/auth/csrf')).json() as { csrfToken: string }
    await commissioner('/api/auth/callback/credentials', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken: csrf.csrfToken, login: user.email!, password,
        callbackUrl: base, json: 'true' }).toString() })
    const session = await (await commissioner('/api/auth/session')).json() as { user?: { id?: string } }
    assert(session.user?.id === user.id, 'Commissioner authentication failed')
    const created = await post(commissioner, '/api/leagues', { concept: 'redraft', sport,
      scoringPreset: sport === 'NBA' ? 'nba_points' : 'fb_half_ppr', teamCount: 22, draftType: 'snake', leagueName: marker,
      timezone: 'America/New_York', conceptSetup: { visibility: 'private', isPublic: false } })
    leagueId = (created.league as { id?: string } | undefined)?.id ?? null
    assert(leagueId, 'League creation returned no ID')
    const path = `/api/leagues/${leagueId}/survivor-guillotine`
    const op = (action: string, rest: Record<string, unknown> = {}) => post(commissioner, `${path}/operations`, { action, ...rest })
    let config = { ...defaultSGConfig(sport, sport === 'NBA' ? 18 : 17), tribeCount: 4,
      nbaScoring: sport === 'NBA' ? 'capped_games' as const : 'total_points' as const, nbaGameCap: 1,
      gauntletElimination: 'league_lowest_two' as const,
      gauntletIdolAuction: process.env.SG_QA_EXERCISE_AUCTION === '1',
      missingSubmission: 'random' as const, periodOverrides: {
        2: 'match_play' as const, 3: 'tribe_champion' as const,
        ...(sport === 'NBA' ? { 9: 'off' as const } : {}),
      },
      enabledPowers: ['personal_immunity', 'ally_immunity', 'steal_player', 'tribe_swap', 'faab_bonus'] as const }
    await post(commissioner, path, { action: 'rules', config }, 'PUT')
    // Commissioner can change setup rules, including budget and submission format.
    config = { ...config, faabBudget: 750, matchupBatchSize: 2, submissionMode: 'commissioner' as const }
    await post(commissioner, path, { action: 'rules', config }, 'PUT')
    assert(buildSGSchedule(config).errors.length === 0, 'Commissioner schedule is invalid')
    const [rosters, seats, playerPools] = await Promise.all([
      prisma.roster.findMany({ where: { leagueId }, orderBy: { id: 'asc' }, select: { id: true, platformUserId: true } }),
      prisma.leagueTeam.findMany({ where: { leagueId }, orderBy: { externalId: 'asc' }, select: { id: true, externalId: true } }),
      sport === 'NBA' ? prisma.player.findMany({ where: { sport: 'NBA' }, take: 22,
        select: { id: true, position: true } }).then(rows => [rows]) :
        Promise.all((['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const).map(position =>
        prisma.player.findMany({ where: { sport: 'NFL', position }, take: position === 'WR' ? 66 : position === 'RB' ? 44 : 22,
          select: { id: true, position: true } }))),
    ])
    assert(rosters.length === 22 && seats.length === 22 && playerPools.every(pool => pool.length >= 22),
      'Synthetic rosters or players unavailable')
    const players = sport === 'NBA' ? playerPools[0] : rosters.flatMap((_, i) =>
      [playerPools[0][i], playerPools[1][i * 2], playerPools[1][i * 2 + 1],
        playerPools[2][i * 3], playerPools[2][i * 3 + 1], playerPools[2][i * 3 + 2],
        playerPools[3][i], playerPools[4][i], playerPools[5][i]])
    assert(players.every(Boolean), 'Complete positional player pool unavailable')
    rosters.sort((a, b) => Number(b.platformUserId === user.id) - Number(a.platformUserId === user.id) || a.id.localeCompare(b.id))
    assert(rosters[0].platformUserId === user.id, 'Commissioner has no native roster')
    for (let i = 0; i < 22; i++) {
      const lineup = players.slice(i * playersPerRoster, i * playersPerRoster + playersPerRoster)
      const playerIds = lineup.map(p => p.id)
      await prisma.roster.update({ where: { id: rosters[i].id }, data: { playerData: {
        players: playerIds, starters: playerIds,
        lineup_sections: { starters: lineup.map(p => ({ id: p.id, position: p.position })),
          bench: [], ir: [], taxi: [], devy: [] },
      } } })
      const seat = seats.find(s => s.externalId === rosters[i].id)
      assert(seat, `Roster ${i} has no claimable seat`)
      if (i > 0) {
        const manager = await prisma.appUser.create({ data: { username: `${marker}-${i}`,
          email: `${marker}-${i}@example.invalid`, emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 6) } })
        userIds.push(manager.id)
      }
      await prisma.leagueTeam.update({ where: { id: seat.id }, data: {
        claimedByUserId: userIds[i], platformUserId: userIds[i] } })
      await prisma.roster.update({ where: { id: rosters[i].id }, data: { platformUserId: userIds[i] } })
    }
    const tribeIds = ['tribe-0', 'tribe-1', 'tribe-2', 'tribe-3']
    const initial = rosters.map((r, i) => ({ rosterId: r.id,
      tribeId: tribeIds[i < 6 ? 0 : i < 12 ? 1 : i < 17 ? 2 : 3] }))
    await op('set_tribes', { members: initial })
    const member = browser()
    const memberCsrf = await (await member('/api/auth/csrf')).json() as { csrfToken: string }
    await member('/api/auth/callback/credentials', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken: memberCsrf.csrfToken,
        login: `${marker}-1@example.invalid`, password, callbackUrl: base, json: 'true' }).toString() })
    const memberSession = await (await member('/api/auth/session')).json() as { user?: { id?: string } }
    assert(memberSession.user?.id === userIds[1], 'Synthetic manager login failed')
    await post(member, `${path}/operations`, { action: 'vote_captain', candidateRosterId: initial[0].rosterId })
    const memberSetupView = await (await member(path)).json() as { ownRoster?: { id: string } }
    assert(memberSetupView.ownRoster?.id === rosters[1].id, 'Manager could not open their native Survivor roster')
    await op('finalize_captains', { choices: Object.fromEntries(tribeIds.map(id => [id,
      initial.find(m => m.tribeId === id)!.rosterId])) })
    await post(commissioner, path, { action: 'seed_draft_powers', playerIds: rosters.map((_, i) => players[i * playersPerRoster].id), count: 3 }, 'PUT')
    const powers = await prisma.survivorGuillotinePower.findMany({ where: { leagueId } })
    assert(powers.length === 3 && powers.some(p => p.kind === 'personal_immunity'), 'Draft idols not seeded')
    const schedule = buildSGSchedule(config).periods
    const start = Date.parse('2025-01-01T00:00:00.000Z')
    const calendar: Record<number, { scoringStartsAt: string; scoringEndsAt: string; selectionDeadlineAt?: string;
      ceremonyAt: string; auctionClosesAt?: string }> = {}
    for (const row of schedule) {
      const day = start + (row.period - 1) * 7 * 86400_000
      calendar[row.period] = { scoringStartsAt: new Date(day).toISOString(),
        scoringEndsAt: new Date(day + 6 * 86400_000).toISOString(),
        ceremonyAt: new Date(day + 6 * 86400_000 + 3600_000).toISOString(),
        ...(config.gauntletIdolAuction && row.mode === 'gauntlet'
          ? { auctionClosesAt: new Date(day + 5 * 86400_000).toISOString() } : {}),
        ...(row.mode === 'match_play' || row.mode === 'tribe_champion'
          ? { selectionDeadlineAt: new Date(day + 2 * 86400_000).toISOString() } : {}) }
    }
    await op('save_calendar', { calendar, rewardPeriods: [1, 4, 7] })
    // Stand in for the completed native draft and its lifecycle transition.
    await prisma.league.update({ where: { id: leagueId }, data: { lifecycleState: 'in_season', status: 'in_season' } })
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true, waiverBudget: true } })
    assert(league.waiverBudget === 750, 'Commissioner FAAB setting did not persist')
    const trace: { period: number; mode: string; chopped: number; active: number; sitOuts: number }[] = []
    let nextPeriodPreAdvanced = false
    for (const row of schedule) {
      let advanced = nextPeriodPreAdvanced ? { result: { advanced: true } } : await op('advance')
      nextPeriodPreAdvanced = false
      if ((advanced.result as { reason?: string })?.reason === 'captain_vote_pending') {
        const before = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
        const chopped = new Set((await prisma.survivorGuillotineChop.findMany({ where: { leagueId, reversedAt: null }, select: { rosterId: true } })).map(c => c.rosterId))
        const members = (before.tribes as { rosterId: string; tribeId: string }[]).filter(m => !chopped.has(m.rosterId))
        await op('finalize_captains', { choices: Object.fromEntries([...new Set(members.map(m => m.tribeId))].map(id =>
          [id, members.find(m => m.tribeId === id)!.rosterId])) })
        advanced = await op('advance')
      }
      assert((advanced.result as { advanced?: boolean })?.advanced, `Period ${row.period} did not advance: ${JSON.stringify(advanced)}`)
      const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
      const members = season.tribes as { rosterId: string; tribeId: string; captain?: boolean }[]
      const state = season.periodState as { priorSitOuts: string[] }
      const byTribe = new Map(tribeIds.map(id => [id, members.filter(m => m.tribeId === id).map(m => m.rosterId)]))
      if (row.mode === 'gauntlet' && process.env.SG_QA_EXERCISE_AUCTION === '1' &&
          !await prisma.survivorGuillotinePower.count({ where: { leagueId, source: 'gauntlet_auction' } })) {
        const beforeAuction = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
        const balanceBeforeAuction = (await prisma.roster.findUniqueOrThrow({ where: { id: rosters[0].id },
          select: { faabRemaining: true } })).faabRemaining
        const priorCalendar = beforeAuction.periodCalendar as Record<string, Record<string, unknown>>
        const openCalendar = { ...priorCalendar, [row.period]: {
          ...priorCalendar[row.period], auctionClosesAt: new Date(Date.now() + 120_000).toISOString() } }
        await prisma.survivorGuillotineLeague.update({ where: { leagueId }, data: {
          periodCalendar: openCalendar as Prisma.InputJsonValue } })
        await post(member, `${path}/operations`, { action: 'auction_bid', amount: 7 })
        await op('auction_bid', { amount: 13 })
        assert(await prisma.survivorGuillotineAuctionBid.count({ where: {
          leagueId, period: row.period, status: 'sealed' } }) === 2, 'Sealed bids were not private and pending')
        const closeCalendar = { ...priorCalendar, [row.period]: {
          ...priorCalendar[row.period], auctionClosesAt: new Date(Date.now() - 1000).toISOString() } }
        await prisma.survivorGuillotineLeague.update({ where: { leagueId }, data: {
          periodCalendar: closeCalendar as Prisma.InputJsonValue } })
        const settled = await op('settle_auction')
        assert((settled.result as { settled?: boolean }).settled, 'Sealed auction did not settle')
        const idol = await prisma.survivorGuillotinePower.findFirstOrThrow({ where: {
          leagueId, source: 'gauntlet_auction' } })
        assert(idol.ownerUserId === userIds[0], 'Highest sealed bidder did not receive the idol')
        const winner = await prisma.roster.findUniqueOrThrow({ where: { id: rosters[0].id } })
        assert(winner.faabRemaining === (balanceBeforeAuction ?? 0) - 13,
          'Winning FAAB bid was not charged')
      }
      if (row.mode === 'match_play') {
        const groups = [...new Set(members.map(m => m.tribeId))].map(id => ({ id, ids: members.filter(m => m.tribeId === id).map(m => m.rosterId) }))
        const min = Math.min(...groups.map(g => g.ids.length))
        const sitOuts: string[] = []
        if (row.period === 2 && state.priorSitOuts.length) {
          const forbidden = await commissioner(`${path}/operations`, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'commissioner_choice',
              choice: { kind: 'sit_out', rosterId: state.priorSitOuts[0] } }) })
          assert(forbidden.status === 409, 'Consecutive sit-out was accepted')
        }
        for (const group of groups) {
          for (const id of group.ids.filter(id => !state.priorSitOuts.includes(id)).slice(0, group.ids.length - min)) {
            await op('commissioner_choice', { choice: { kind: 'sit_out', rosterId: id } })
            sitOuts.push(id)
          }
        }
        assert(sitOuts.every(id => !state.priorSitOuts.includes(id)), 'Consecutive sit-out accepted')
        const pools = groups.map(g => ({ id: g.id, ids: g.ids.filter(id => !sitOuts.includes(id)) }))
        while (pools.some(g => g.ids.length)) {
          pools.sort((a, b) => b.ids.length - a.ids.length)
          assert(pools[0].ids.length && pools[1].ids.length, `Unpairable period ${row.period}`)
          await op('commissioner_choice', { choice: { kind: 'matchup', team1: pools[0].ids.shift(), team2: pools[1].ids.shift() } })
        }
      } else if (row.mode === 'tribe_champion') {
        for (const id of new Set(members.map(m => m.tribeId))) {
          await op('commissioner_choice', { choice: { kind: 'champion', rosterId: byTribe.get(id)![0] } })
        }
      }
      const targetTribe = `tribe-${1 + ((row.period - 1) % 3)}`
      const scoreRows = members.map((m, i) => ({ leagueId, season: league.season, week: row.period,
        rosterId: m.rosterId, totalPoints: (m.tribeId === 'tribe-0' ? 300 :
          m.tribeId === targetTribe ? 100 : 200) + i / 100 + row.period }))
      if (row.mode !== 'off') {
        await prisma.teamWeekResult.createMany({ data: scoreRows })
        if (sport === 'NBA') {
          const day = new Date(Date.parse(calendar[row.period].scoringStartsAt) + 2 * 86400_000)
          const lineupDay = new Date(Date.parse(calendar[row.period].scoringStartsAt) + 86400_000)
          await prisma.afRosterLineupAssignment.createMany({ data: members.map(m => ({ leagueId,
            rosterId: m.rosterId, season: league.season, week: row.period, section: 'starters', slotIndex: 0,
            playerId: players[rosters.findIndex(r => r.id === m.rosterId)].id })) })
          await prisma.survivorGuillotineDailyLineup.createMany({ data: members.map(m => ({ leagueId,
            rosterId: m.rosterId, period: row.period, gameDay: lineupDay,
            playerIds: [players[rosters.findIndex(r => r.id === m.rosterId)].id] })) })
          await prisma.playerGameStat.createMany({ data: scoreRows.map(score => ({
            playerId: players[rosters.findIndex(r => r.id === score.rosterId)].id,
            gameId: `${marker}-${row.period}`, sportType: 'NBA', season: league.season,
            weekOrRound: row.period, gameDate: day, statPayload: { pts: score.totalPoints },
            normalizedStatMap: { stats: { pts: score.totalPoints } }, fantasyPoints: score.totalPoints,
            source: marker,
          })) })
        }
      }
      if (row.period === 1 && process.env.SG_QA_EXERCISE_IDOL === '1') {
        const idol = await prisma.survivorGuillotinePower.findFirstOrThrow({ where: {
          leagueId, kind: 'personal_immunity', binding: 'player' } })
        const ownerIndex = rosters.findIndex((_, i) => players.slice(i * playersPerRoster,
          (i + 1) * playersPerRoster).some(p => p.id === idol.playerId))
        assert(ownerIndex >= 0, 'Draft idol has no drafted owner')
        let ownerRequest = commissioner
        if (ownerIndex > 0) {
          ownerRequest = browser()
          const ownerCsrf = await (await ownerRequest('/api/auth/csrf')).json() as { csrfToken: string }
          await ownerRequest('/api/auth/callback/credentials', { method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ csrfToken: ownerCsrf.csrfToken,
              login: `${marker}-${ownerIndex}@example.invalid`, password, callbackUrl: base, json: 'true' }).toString() })
        }
        const before = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
        const originalState = before.periodState as Record<string, unknown>
        const temporaryDeadline = new Date(Date.now() + 120_000).toISOString()
        await prisma.survivorGuillotineLeague.update({ where: { leagueId }, data: {
          periodState: { ...originalState, ceremonyAt: temporaryDeadline,
            immunityDeadlineAt: temporaryDeadline } as Prisma.InputJsonValue } })
        await post(ownerRequest, `${path}/chimmy`, { message: `@chimmy use idol ${idol.id}` })
        const sealed = await prisma.survivorGuillotinePower.findUniqueOrThrow({ where: { id: idol.id } })
        assert(sealed.status === 'sealed', 'Private Chimmy activation did not seal the idol')
        const current = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
        await prisma.survivorGuillotineLeague.update({ where: { leagueId }, data: {
          periodState: { ...(current.periodState as Record<string, unknown>),
            ceremonyAt: originalState.ceremonyAt ?? null,
            immunityDeadlineAt: originalState.immunityDeadlineAt ?? null } as Prisma.InputJsonValue } })
      }
      let result: Record<string, unknown>
      if (row.period === 2 && process.env.SG_QA_EXERCISE_AUTO_CHOP === '1') {
        assert(process.env.SG_QA_CRON_SECRET, 'QA cron secret is required')
        // Keep the next period's picks open after the heartbeat advances this historical season.
        const preCron = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
        const preCronCalendar = preCron.periodCalendar as Record<string, Record<string, unknown>>
        await prisma.survivorGuillotineLeague.update({ where: { leagueId }, data: {
          periodCalendar: { ...preCronCalendar, 3: { ...preCronCalendar[3],
            selectionDeadlineAt: new Date(Date.now() + 3600_000).toISOString() } } as Prisma.InputJsonValue } })
        const cron = await fetch(`${base}/api/cron/waivers?leagueId=${leagueId}`, {
          headers: { authorization: `Bearer ${process.env.SG_QA_CRON_SECRET}` },
          signal: AbortSignal.timeout(180_000) })
        assert(cron.ok, `Scheduled Chop Night heartbeat failed: ${cron.status}`)
        const autoChops = await prisma.survivorGuillotineChop.findMany({ where: {
          leagueId, period: row.period, reversedAt: null }, select: { rosterId: true } })
        assert(autoChops.length === row.chops, 'Scheduled Chop Night did not chop the synthetic league')
        result = { result: { choppedTeamIds: autoChops.map(c => c.rosterId) } }
        nextPeriodPreAdvanced = true
      } else {
        result = await post(commissioner, `${path}/chop`, { period: row.period })
      }
      if (row.period === 1) {
        const firstChop = (result.result as { choppedTeamIds: string[] }).choppedTeamIds[0]
        await prisma.teamWeekResult.update({ where: { leagueId_season_week_rosterId: {
          leagueId, season: league.season, week: 1, rosterId: firstChop } },
          data: { totalPoints: 250 } })
        if (sport === 'NBA') await prisma.playerGameStat.update({ where: { playerId_sportType_gameId: {
          playerId: players[rosters.findIndex(r => r.id === firstChop)].id,
          sportType: 'NBA', gameId: `${marker}-1` } },
          data: { normalizedStatMap: { stats: { pts: 250 } }, fantasyPoints: 250 } })
        const corrected = await post(commissioner, `${path}/chop`, { action: 'reconcile_correction' })
        assert((corrected.result as { status: string }).status === 'reversed', 'Stat correction did not reverse the chop')
        assert(await prisma.survivorGuillotineChop.count({ where: { leagueId, period: 1, reversedAt: { not: null } } }) === 1,
          'Reversed chop lacks its audit row')
        result = await post(commissioner, `${path}/chop`, { period: 1 })
        assert((result.result as { choppedTeamIds: string[] }).choppedTeamIds[0] !== firstChop,
          'Corrected scores did not change the chopped roster')
      }
      const resolved = result.result as { choppedTeamIds?: string[]; placements?: string[] }
      if (row.period === 1 && process.env.SG_QA_EXERCISE_IDOL === '1') {
        const idol = await prisma.survivorGuillotinePower.findFirstOrThrow({ where: {
          leagueId, kind: 'personal_immunity', binding: 'player' } })
        assert(idol.status === 'used' && idol.revealedAt,
          'Played idol was not consumed and revealed at Chop Night')
      }
      assert(resolved.choppedTeamIds?.length === row.chops, `Period ${row.period} chop count mismatch`)
      trace.push({ period: row.period, mode: row.mode, chopped: row.chops,
        active: row.teamsLeaving, sitOuts: row.mode === 'match_play' ?
          ((await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })).periodState as { sitOuts: string[] }).sitOuts.length : 0 })
      console.log(JSON.stringify({ completed: row.period, mode: row.mode, chops: row.chops }))
      if (row.period === 2 && process.env.SG_QA_EXERCISE_AUTO_CHOP === '1') {
        console.log(JSON.stringify({ sport, scheduledChopNight: true, unevenTribes: true,
          consecutiveSitOutRejected: true, privateChimmyIdol: process.env.SG_QA_EXERCISE_IDOL === '1' }))
        return
      }
      if (row.period === 1 && process.env.SG_QA_STOP_AFTER_FIRST === '1') {
        console.log(JSON.stringify({ sport, managerVote: true, privateRoster: true,
          correctionReversal: true, futureCalendarEdit: true, waiverProcessed: sport === 'NFL',
          chimmyIdol: process.env.SG_QA_EXERCISE_IDOL === '1' }))
        return
      }
      if (row.period === 1) {
        const releasedRoster = rosters.find(r => r.id === resolved.choppedTeamIds![0])!
        if (sport === 'NFL') {
          const releasedPlayerId = players[rosters.indexOf(releasedRoster) * playersPerRoster].id
          const claim = await post(commissioner, `/api/waiver-wire/leagues/${leagueId}/claims`,
            { addPlayerId: releasedPlayerId, faabBid: 5 })
          assert(claim.claim, 'Chopped player waiver claim was not created')
          const processed = await post(commissioner, `/api/waiver-wire/leagues/${leagueId}/process`, {})
          assert(Number(processed.processed) >= 1, 'Chopped player waiver claim was not processed')
          const owned = await prisma.roster.findUniqueOrThrow({ where: { id: rosters[0].id }, select: { playerData: true } })
          assert(JSON.stringify(owned.playerData).includes(releasedPlayerId), 'Waiver winner did not receive chopped player')
        }
        await post(commissioner, path, { action: 'award_weekly_power', period: 1 }, 'PUT')
        const memberView = await (await member(path)).json() as { powers?: { id: string }[] }
        const reward = await prisma.survivorGuillotinePower.findFirstOrThrow({ where: { leagueId, awardPeriod: 1 } })
        if (reward.ownerUserId !== userIds[1]) assert(!memberView.powers?.some(p => p.id === reward.id),
          'Concealed reward leaked to another manager')
        const editedCalendar = { ...calendar, 5: { ...calendar[5], ceremonyAt:
          new Date(Date.parse(calendar[5].ceremonyAt) + 3600_000).toISOString() } }
        await op('save_calendar', { calendar: editedCalendar, rewardPeriods: [] })
        const locked = await commissioner(path, { method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'rules', config }) })
        assert(locked.status === 400, 'Active-season rule rewrite was allowed')
      }
      if (row.mode === 'final_three') {
        assert(resolved.placements?.length === 3, 'Final placement missing')
        break
      }
    }
    const season = await prisma.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
    const chops = await prisma.survivorGuillotineChop.count({ where: { leagueId, reversedAt: null } })
    assert(season.status === 'completed' && chops === 19, 'Season did not finish with 19 chops and three finalists')
    console.log(JSON.stringify({ marker, sport, periods: trace, finalStatus: season.status,
      chops, powers: await prisma.survivorGuillotinePower.count({ where: { leagueId } }) }))
  } finally {
    if (sport === 'NBA') await prisma.playerGameStat.deleteMany({ where: { source: marker } })
    if (leagueId) await prisma.league.deleteMany({ where: { id: leagueId } })
    if (userIds.length) {
      await prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.appUser.deleteMany({ where: { id: { in: userIds } } })
    }
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1 })
