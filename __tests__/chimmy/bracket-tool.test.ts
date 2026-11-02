import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generic: vi.fn(), world: vi.fn(), playoff: vi.fn(), ranks: vi.fn(),
  genericDetail: vi.fn(), worldDetail: vi.fn(), playoffDetail: vi.fn(),
  nodes: vi.fn(), poolPicks: vi.fn(), risk: vi.fn(), simulation: vi.fn(), health: vi.fn(), leader: vi.fn(),
  worldMatches: vi.fn(), playoffSeries: vi.fn(),
  profileFind: vi.fn(), profileUpsert: vi.fn(), rawWrite: vi.fn(), dispatch: vi.fn(),
  playoffChallenge: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  bracketEntry: { findMany: mocks.generic, findFirst: mocks.genericDetail },
  worldCupBracketEntry: { findMany: mocks.world, findFirst: mocks.worldDetail },
  playoffBracketEntry: { findMany: mocks.playoff, findFirst: mocks.playoffDetail },
  playoffBracketChallenge: { findUnique: mocks.playoffChallenge },
  bracketLeaderboard: { findMany: mocks.ranks, findFirst: mocks.leader },
  bracketSimulationSnapshot: { findUnique: mocks.simulation },
  bracketHealthSnapshot: { findUnique: mocks.health },
  bracketNode: { findMany: mocks.nodes },
  bracketPick: { findMany: mocks.poolPicks },
  bracketRiskProfile: { findUnique: mocks.risk },
  worldCupBracketMatch: { findMany: mocks.worldMatches },
  playoffBracketSeries: { findMany: mocks.playoffSeries },
  userProfile: { findUnique: mocks.profileFind, upsert: mocks.profileUpsert },
  $executeRaw: mocks.rawWrite,
} }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: mocks.dispatch }))
vi.mock('@/lib/ai-product-layer/UnifiedChimmyEntryResolver', () => ({
  getChimmyChatHrefWithPrompt: (prompt: string, context?: { sport?: string }) => `/chimmy/chat?prompt=${encodeURIComponent(prompt)}&sport=${context?.sport ?? ''}`,
}))

import { bracketSelectionFromQuestion, buildBracketEntryContext, buildMyBracketsContext, selectOwnedBracket } from '@/lib/chimmy/tools/bracketTool'
import { CHIMMY_TOOL_SPECS } from '@/lib/chimmy/tools/chimmyTools'
import { answerReadLeague } from '@/lib/chimmy/tools/answerReadLeague'
import { bracketFollowUps, bracketPromptTarget, readBracketEvidence, type BracketEvidence } from '@/lib/chimmy/bracketEvidence'
import { bracketChangeAlertsEnabled, bracketChangeSummary, emitBracketChangeAlert, emitPlayoffDecisionAlerts, setBracketChangeAlertsEnabled, settleBracketAlertBatch } from '@/lib/chimmy/bracketChangeAlerts'

const stamp = new Date('2026-03-20T12:00:00.000Z')
const generic = { id: 'g1', name: 'My March Entry', status: 'DRAFT', updatedAt: stamp, leagueId: 'league-1',
  league: { name: 'Office Pool', tournamentId: 'tournament-1', tournament: { sport: 'NCAAB', season: 2026 } } }
const world = { id: 'w1', name: 'World Picks', updatedAt: stamp, totalScore: 18, rank: 3, isLocked: true,
  challenge: { id: 'world-1', name: 'Friends Cup', seasonYear: 2026 } }
const playoff = { id: 'p1', name: 'West Picks', updatedAt: stamp, finalizedAt: null,
  challenge: { id: 'playoff-1', name: 'Playoff Crew', sport: 'NBA', seasonYear: 2026 } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.generic.mockResolvedValue([generic])
  mocks.world.mockResolvedValue([world])
  mocks.playoff.mockResolvedValue([playoff])
  mocks.ranks.mockResolvedValue([{ entryId: 'g1', leagueId: 'league-1', rank: 2, score: 42 }])
  mocks.nodes.mockResolvedValue([])
  mocks.poolPicks.mockResolvedValue([])
  mocks.risk.mockResolvedValue(null)
  mocks.simulation.mockResolvedValue(null)
  mocks.health.mockResolvedValue(null)
  mocks.leader.mockResolvedValue(null)
  mocks.worldMatches.mockResolvedValue([])
  mocks.playoffSeries.mockResolvedValue([])
  mocks.profileFind.mockResolvedValue(null)
  mocks.rawWrite.mockResolvedValue(1)
  mocks.profileUpsert.mockResolvedValue({ userId: 'owner-1' })
  mocks.dispatch.mockResolvedValue({ delivered: 1, requested: 1, suppressed: 0, failed: 0 })
  mocks.playoffChallenge.mockResolvedValue(null)
})

describe('Chimmy bracket grounding', () => {
  it('registers bracket reads without accepting a model-supplied league or entry ID', () => {
    const specs = CHIMMY_TOOL_SPECS.filter((spec) => ['get_my_brackets', 'get_bracket_entry'].includes(spec.function.name))
    expect(specs.map((spec) => spec.function.name)).toEqual(['get_my_brackets', 'get_bracket_entry'])
    for (const spec of specs) {
      expect(Object.keys(spec.function.parameters.properties)).not.toContain('leagueId')
      expect(Object.keys(spec.function.parameters.properties)).not.toContain('entryId')
    }
    expect(answerReadLeague(['get_my_brackets', 'get_bracket_entry'])).toBe(false)
  })
  it('lists all three owned bracket formats with stored rank provenance and scoped reads', async () => {
    const text = await buildMyBracketsContext('owner-1')
    expect(text).toContain('My March Entry — Office Pool')
    expect(text).toContain('score 42; pool rank 2')
    expect(text).toContain('World Picks — Friends Cup')
    expect(text).toContain('West Picks — Playoff Crew')
    expect(text).toContain('/bracket/tournament-1/entry/g1')
    expect(text).toContain('Scores across different pools or formats are not directly comparable')
    for (const read of [mocks.generic, mocks.world, mocks.playoff]) {
      expect(read).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner-1' } }))
    }
  })

  it('requires an unambiguous owned entry before any detailed read', async () => {
    const text = await buildBracketEntryContext('owner-1', {})
    expect(text).toContain('Several owned bracket entries match')
    expect(mocks.genericDetail).not.toHaveBeenCalled()
    expect(mocks.worldDetail).not.toHaveBeenCalled()
    expect(mocks.playoffDetail).not.toHaveBeenCalled()
  })

  it('selects the latest entry only when explicitly requested and refuses a timestamp tie', () => {
    const first = { kind: 'tournament', id: 'a', name: 'A', pool: 'Office Pool', sport: 'NCAAB', season: 2026,
      status: 'DRAFT', score: null, rank: null, updatedAt: new Date('2026-03-20T12:00:00Z'), scoreUpdatedAt: null, href: '/a' }
    const newer = { ...first, id: 'b', name: 'B', updatedAt: new Date('2026-03-21T12:00:00Z') }
    expect(selectOwnedBracket([first, newer] as any, { latest: true })).toMatchObject({ kind: 'selected', entry: { id: 'b' } })
    expect(selectOwnedBracket([first, newer] as any, { entry_name: 'B', pool_name: 'Office' })).toMatchObject({ kind: 'selected', entry: { id: 'b' } })
    expect(selectOwnedBracket([first, newer] as any, {})).toMatchObject({ kind: 'ambiguous' })
    expect(selectOwnedBracket([first, { ...newer, updatedAt: first.updatedAt }] as any, { latest: true })).toMatchObject({ kind: 'ambiguous' })
  })

  it('analyzes an unsaved tournament matchup from an owned entry with a bounded pool sample', async () => {
    mocks.genericDetail.mockResolvedValue({ status: 'DRAFT', lockedAt: null, updatedAt: stamp, leagueId: 'league-1',
      league: { tournamentId: 'tournament-1', tournament: { lockAt: new Date('2027-03-21T12:00:00.000Z') } }, picks: [] })
    mocks.nodes.mockResolvedValue([{ id: 'node-1', round: 1, homeTeamName: 'Duke', awayTeamName: 'UNC', seedHome: 1, seedAway: 8 }])
    mocks.poolPicks.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ pickedTeamName: i < 4 ? 'Duke' : 'UNC' })))
    mocks.simulation.mockResolvedValue({ winLeagueProbability: 0.27, top5Probability: 0.65,
      expectedRank: 4.2, simulations: 1000, updatedAt: stamp })
    mocks.health.mockResolvedValue({ healthScore: 72, statusLabel: 'healthy', updatedAt: stamp })
    mocks.leader.mockResolvedValue({ rank: 1, score: 60, updatedAt: stamp })
    const evidence: BracketEvidence[] = []
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'My March Entry', pool_name: 'Office Pool', team: 'Duke', opponent: 'UNC' }, (row) => evidence.push(row))
    expect(text).toContain('MATCHUP Duke vs UNC')
    expect(text).toContain('your saved pick none')
    expect(text).toContain('Submitted pool entries picking each')
    expect(text).toContain('Bracket strategy engine leans')
    expect(text).toContain('Safer seed-based case: Duke')
    expect(text).toContain('Upset case: UNC')
    expect(text).toContain('Pool leader: rank 1, 60 points')
    expect(text).toContain('Bracket health snapshot: 72/100')
    expect(text).toContain('27% win pool')
    expect(mocks.genericDetail).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'g1', userId: 'owner-1' } }))
    expect(mocks.generic).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'owner-1', name: { contains: 'My March Entry', mode: 'insensitive' } },
    }))
    expect(mocks.nodes).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tournamentId: 'tournament-1' }) }))
    expect(mocks.poolPicks).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ entry: expect.objectContaining({ leagueId: 'league-1' }) }) }))
    expect(mocks.risk).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'owner-1' } }))
    expect(evidence).toMatchObject([{ entryName: 'My March Entry', poolName: 'Office Pool',
      href: '/bracket/tournament-1/entry/g1', format: 'tournament' }])
    expect(bracketFollowUps(evidence[0])[0]).toContain('bracket entry "My March Entry" in pool "Office Pool"')
  })

  it('does not issue a source card when the second owner read fails', async () => {
    mocks.genericDetail.mockResolvedValue(null)
    const evidence: BracketEvidence[] = []
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'My March Entry' }, (row) => evidence.push(row))
    expect(text).toContain('could not be verified as yours')
    expect(evidence).toEqual([])
    expect(mocks.profileFind).not.toHaveBeenCalled()
  })

  it('reads a saved before-and-after score change only after verifying the entry owner', async () => {
    mocks.genericDetail.mockResolvedValue({ status: 'SCORED', lockedAt: stamp, updatedAt: stamp, leagueId: 'league-1',
      league: { tournamentId: 'tournament-1', tournament: { lockAt: stamp } }, picks: [] })
    mocks.profileFind.mockResolvedValue({ notificationPreferences: { chimmyBracketChangeLatest: { 'tournament:g1': {
      format: 'tournament', entryId: 'g1', observedAt: stamp.toISOString(),
      before: { score: 30, rank: 4 }, after: { score: 42, rank: 2 },
    } } } })
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'My March Entry' })
    expect(text).toContain('LATEST RECORDED BRACKET CHANGE')
    expect(text).toContain('score +12 (30 to 42); pool rank 4 to 2')
    expect(mocks.profileFind).toHaveBeenCalledWith({
      where: { userId: 'owner-1' }, select: { notificationPreferences: true },
    })
  })

  it('uses an older alert reference to explain its exact change instead of the newest one', async () => {
    const oldRef = 'e5c19b8a-9d2b-4f33-9f02-a8a15e3c1e22'
    const newRef = 'f5c19b8a-9d2b-4f33-9f02-a8a15e3c1e23'
    mocks.genericDetail.mockResolvedValue({ status: 'SCORED', lockedAt: stamp, updatedAt: stamp,
      leagueId: 'league-1', league: { tournamentId: 'tournament-1', tournament: { lockAt: stamp } }, picks: [] })
    mocks.profileFind.mockResolvedValue({ notificationPreferences: { chimmyBracketChangeHistory: {
      'tournament:g1': [
        { changeRef: oldRef, format: 'tournament', entryId: 'g1', observedAt: stamp.toISOString(),
          before: { score: 10, rank: 5 }, after: { score: 20, rank: 3 } },
        { changeRef: newRef, format: 'tournament', entryId: 'g1', observedAt: stamp.toISOString(),
          before: { score: 20, rank: 3 }, after: { score: 42, rank: 2 } },
      ],
    } } })
    const selected = await buildBracketEntryContext('owner-1', { entry_name: 'My March Entry', change_ref: oldRef })
    expect(selected).toContain('REQUESTED RECORDED BRACKET CHANGE')
    expect(selected).toContain('score +10 (10 to 20)')
    expect(selected).not.toContain('score +22 (20 to 42)')
    const newest = await buildBracketEntryContext('owner-1', { entry_name: 'My March Entry' })
    expect(newest).toContain('score +22 (20 to 42)')
    const missing = await buildBracketEntryContext('owner-1', { entry_name: 'My March Entry',
      change_ref: 'a5c19b8a-9d2b-4f33-9f02-a8a15e3c1e24' })
    expect(missing).toContain('requested change reference is unavailable or expired')
    expect(missing).not.toContain('score +22 (20 to 42)')
  })

  it('requires a per-entry opt-in before dispatching a change alert', async () => {
    const input = { userId: 'owner-1', entryId: 'g1', entryName: 'My March Entry', poolName: 'Office Pool',
      format: 'tournament' as const, before: { score: 30, rank: 4 }, after: { score: 42, rank: 2 } }
    expect(bracketChangeAlertsEnabled(null, 'tournament', 'g1')).toBe(false)
    expect(await emitBracketChangeAlert(input)).toBe(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
    mocks.profileFind.mockResolvedValue({ notificationPreferences: { chimmyBracketChanges: {
      entries: { 'tournament:g1': true },
    } } })
    expect(await emitBracketChangeAlert(input)).toBe(true)
    expect(mocks.rawWrite).toHaveBeenCalledOnce()
    expect(mocks.rawWrite.mock.invocationCallOrder[0]).toBeLessThan(mocks.dispatch.mock.invocationCallOrder[0])
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      category: 'bracket_updates', type: 'chimmy_bracket_change',
      actionHref: expect.stringContaining('What%20changed%20in%20my%20bracket%20entry'),
      skipChannels: { email: true, sms: true },
    }))
    const delivered = mocks.dispatch.mock.calls[0][0]
    expect(delivered.meta.changeRef).toMatch(/^[0-9a-f-]{36}$/)
    expect(decodeURIComponent(delivered.actionHref)).toContain(`Change ref: ${delivered.meta.changeRef}`)
    expect(delivered.body).not.toContain('42')
    expect(delivered.meta.before).toBeUndefined()
    expect(new URL(delivered.actionHref, 'https://qa.invalid').searchParams.get('sport')).toBe('NCAAB')
  })

  it('saves the opt-in without overwriting the user’s other notification settings', async () => {
    await setBracketChangeAlertsEnabled('owner-1', 'world_cup', 'w1', true)
    expect(mocks.profileUpsert).toHaveBeenCalledWith({
      where: { userId: 'owner-1' }, create: { userId: 'owner-1' }, update: {},
    })
    expect(mocks.rawWrite).toHaveBeenCalledOnce()
    expect(mocks.profileUpsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.rawWrite.mock.invocationCallOrder[0])
  })

  it('summarizes a decided playoff pick without treating it as an entry score', () => {
    expect(bracketChangeSummary({ winnerTeamName: null }, {
      winnerTeamName: 'Boston', pickTeamName: 'Denver', seriesName: 'Boston vs Denver',
    })).toBe('Boston vs Denver: Boston won; your pick Denver (incorrect)')
    expect(bracketChangeSummary({ winnerTeamName: 'Denver' }, {
      winnerTeamName: 'Boston', pickTeamName: 'BOSTON', seriesName: 'Boston vs Denver',
    })).toBe('Boston vs Denver: winner corrected from Denver to Boston; your pick BOSTON (correct)')
  })

  it('caps alert dispatch concurrency for large pools and counts failed sends', async () => {
    let active = 0
    let peak = 0
    const failed = await settleBracketAlertBatch(Array.from({ length: 35 }, (_, index) => index), async (index) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      if (index === 4 || index === 30) throw new Error('delivery failed')
    })
    expect(failed).toBe(2)
    expect(peak).toBe(16)
  })

  it('does not dispatch playoff changes from commissioner test pools', async () => {
    mocks.playoffChallenge.mockResolvedValue({ name: 'Test Pool', isTestMode: true })
    await emitPlayoffDecisionAlerts({ challengeId: 'p1', decisions: [
      { seriesId: 's1', seriesName: 'Boston vs Denver', beforeWinner: null, winner: 'Boston' },
    ] })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('sends a decided playoff pick only to an opted-in entry owner', async () => {
    mocks.playoffChallenge.mockResolvedValue({ name: 'Playoff Crew', sport: 'NCAAF', isTestMode: false })
    mocks.playoff.mockResolvedValue([{ id: 'p1', userId: 'owner-1', name: 'West Picks',
      picks: [{ seriesId: 's1', pickTeamName: 'Boston' }] }])
    mocks.profileFind.mockResolvedValue({ notificationPreferences: { chimmyBracketChanges: {
      entries: { 'playoff:p1': true },
    } } })
    await emitPlayoffDecisionAlerts({ challengeId: 'playoff-1', decisions: [
      { seriesId: 's1', seriesName: 'Boston vs Denver', beforeWinner: null, winner: 'Boston' },
    ] })
    expect(mocks.playoff).toHaveBeenCalledWith(expect.objectContaining({
      where: { challengeId: 'playoff-1', finalizedAt: { not: null } },
    }))
    expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['owner-1'], body: 'Open Chimmy to see the saved before-and-after result.',
      actionHref: expect.stringContaining('&sport=NCAAF'),
    }))
  })

  it('rejects malformed bracket evidence before rendering it', () => {
    const valid = { entryName: 'A', poolName: 'B', sport: 'NCAAB', format: 'tournament',
      href: '/bracket/a', entryUpdatedAt: stamp.toISOString(), scoreUpdatedAt: null, readAt: stamp.toISOString() }
    expect(readBracketEvidence(valid)).toMatchObject(valid)
    expect(readBracketEvidence({ ...valid, href: '//other-site.example' })).toBeNull()
    expect(readBracketEvidence({ ...valid, readAt: 'yesterday' })).toBeNull()
  })

  it('does not recommend changing a locked entry or expose a small pool distribution', async () => {
    mocks.genericDetail.mockResolvedValue({ status: 'LOCKED', lockedAt: stamp, updatedAt: stamp, leagueId: 'league-1',
      league: { tournamentId: 'tournament-1', tournament: { lockAt: stamp } }, picks: [] })
    mocks.nodes.mockResolvedValue([{ id: 'node-1', round: 1, homeTeamName: 'Duke', awayTeamName: 'UNC', seedHome: 1, seedAway: 8 }])
    mocks.poolPicks.mockResolvedValue([{ pickedTeamName: 'Duke' }])
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'My March Entry', team: 'Duke' })
    expect(text).toContain('Pool pick percentages withheld')
    expect(text).toContain('Entry is locked; discuss implications only')
    expect(text).not.toContain('Bracket strategy engine leans')
  })

  it('includes World Cup group picks and time-labelled scores from the owned entry', async () => {
    mocks.worldDetail.mockResolvedValue({ championTeamName: 'Brazil', totalScore: 18, maxPossibleScore: 100,
      correctPicks: 3, incorrectPicks: 1, rank: 3, isLocked: true, isComplete: true, updatedAt: stamp,
      challenge: { id: 'world-1', status: 'live', lastSyncedAt: stamp, pickLockAt: stamp },
      picks: [{ selectedTeamName: 'Brazil', pointsAwarded: 3, isCorrect: true,
        match: { round: 'R32', homeTeamName: 'Brazil', awayTeamName: 'Japan', homeScore: 2, awayScore: 1,
          status: 'final', winnerTeamName: 'Brazil', lastScoreSyncedAt: stamp } }],
      groupRankingPicks: [{ predictedRank: 1, actualRank: 1, isCorrect: true, pointsAwarded: 2,
        group: { displayName: 'Group A' }, team: { name: 'Brazil' } }],
      thirdPlaceAdvancerPicks: [],
    })
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'World Picks', pool_name: 'Friends Cup', sport: 'World Cup' })
    expect(text).toContain('Champion pick Brazil')
    expect(text).toContain('GROUP RANKING PICKS: Group A: Brazil predicted #1')
    expect(text).toContain('2026-03-20T12:00:00.000Z')
    expect(mocks.worldDetail).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'w1', userId: 'owner-1' } }))
  })

  it('reads a playoff series snapshot without inventing a leaderboard rank', async () => {
    mocks.playoffDetail.mockResolvedValue({ challengeId: 'playoff-1', finalizedAt: stamp, tiebreakerTotalScore: 221, updatedAt: stamp,
      picks: [{ pickTeamName: 'Boston', series: { round: 'Final', homeTeamName: 'Boston', awayTeamName: 'Denver',
        homeSeed: 1, awaySeed: 2, winnerTeamName: null, homeTeamWins: 2, awayTeamWins: 1,
        liveHomeScore: 100, liveAwayScore: 97, status: 'in_progress', liveStatus: 'Q4', lastSyncedAt: stamp } }],
    })
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'West Picks', pool_name: 'Playoff Crew', team: 'Boston' })
    expect(text).toContain('live game score 100-97 (Q4)')
    expect(text).toContain('last synced 2026-03-20T12:00:00.000Z')
    expect(text).toContain('does not store a per-entry score or leaderboard rank')
    expect(mocks.playoffDetail).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', userId: 'owner-1' } }))
  })

  it('reads an unsaved World Cup matchup only inside the owned challenge', async () => {
    mocks.worldDetail.mockResolvedValue({ championTeamName: null, totalScore: 0, maxPossibleScore: 0,
      correctPicks: 0, incorrectPicks: 0, rank: null, isLocked: false, isComplete: false, updatedAt: stamp,
      challenge: { id: 'world-1', status: 'open', lastSyncedAt: stamp, pickLockAt: null },
      picks: [], groupRankingPicks: [], thirdPlaceAdvancerPicks: [],
    })
    mocks.worldMatches.mockResolvedValue([{ round: 'R32', homeTeamName: 'Brazil', awayTeamName: 'Japan',
      homeScore: null, awayScore: null, status: 'scheduled', winnerTeamName: null, lastScoreSyncedAt: null }])
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'World Picks', team: 'Brazil', opponent: 'Japan' })
    expect(text).toContain('NO SAVED PICK in this entry')
    expect(text).toContain('score ?-?')
    expect(mocks.worldMatches).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ challengeId: 'world-1' }) }))
  })

  it('reads an unsaved playoff series only inside the owned challenge', async () => {
    mocks.playoffDetail.mockResolvedValue({ challengeId: 'playoff-1', finalizedAt: null,
      tiebreakerTotalScore: null, updatedAt: stamp, picks: [] })
    mocks.playoffSeries.mockResolvedValue([{ round: 'West', homeTeamName: 'Denver', awayTeamName: 'Phoenix',
      homeSeed: 1, awaySeed: 4, winnerTeamName: null, homeTeamWins: 0, awayTeamWins: 0,
      liveHomeScore: null, liveAwayScore: null, status: 'scheduled', liveStatus: null, lastSyncedAt: null }])
    const text = await buildBracketEntryContext('owner-1', { entry_name: 'West Picks', team: 'Denver', opponent: 'Phoenix' })
    expect(text).toContain('NO SAVED PICK in this entry')
    expect(text).toContain('live game score ?-?')
    expect(mocks.playoffSeries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ challengeId: 'playoff-1' }) }))
  })

  it('parses only the bracket page prefill into a fallback selection', () => {
    expect(bracketSelectionFromQuestion('Review my bracket entry "A" in pool "B".')).toEqual({ entry_name: 'A', pool_name: 'B' })
    const quoted = `Review my ${bracketPromptTarget('My "Upset" Pick', 'Office "A"')}.`
    expect(bracketSelectionFromQuestion(quoted)).toEqual({ entry_name: 'My "Upset" Pick', pool_name: 'Office "A"' })
    const notification = `What changed in my ${bracketPromptTarget('My Entry', 'My Pool')}? Change ref: e5c19b8a-9d2b-4f33-9f02-a8a15e3c1e22.`
    expect(bracketSelectionFromQuestion(notification)).toEqual({ entry_name: 'My Entry', pool_name: 'My Pool',
      change_ref: 'e5c19b8a-9d2b-4f33-9f02-a8a15e3c1e22' })
    expect(bracketSelectionFromQuestion('Who should I pick in the bracket?')).toEqual({})
  })
})
