import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * THE TRADE HUB'S DEAL POINTS FROM THE USER'S SIDE, END TO END (see lib/legacy/tradeHubDirection.ts).
 *
 * Team A defaults to the user's own roster and its players are picked from that roster, so Team A's
 * list is what the user GIVES. Until 2026-09-30 it was labelled "You Get" and sent to both graders as
 * the side the user RECEIVES, so the letter shown was the partner's side of the deal.
 *
 *   UI      — Team A's panel reads "You Give" / "Your Team"; Team B's "You Get" / "From Team".
 *   request — Quick evaluate: assetsYouGive = Team A's list. Full analyzer: assetsB = Team A's list.
 *   grade   — each route grades give = what the user sends, so the letter is the user's.
 */

const mockCreateGrader = vi.hoisted(() => vi.fn())
const mockGradeOf = vi.hoisted(() => vi.fn())

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/legacy/legacyOneGrade', () => ({
  createLegacyPackageGrader: mockCreateGrader,
  legacySessionUserId: vi.fn(async () => 'af-user-1'),
}))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async () => [
    { player: { name: 'Josh Allen', position: 'QB' }, value: 9000 },
    { player: { name: 'Puka Nacua', position: 'WR' }, value: 7000 },
  ]),
}))
vi.mock('@/lib/trade-engine/manager-tendency-engine', () => ({
  computeManagerTendencies: vi.fn(async () => null),
  computeAcceptProbability: vi.fn(),
}))

import { POST } from '@/server/api-route-modules/legacy/trade/quick-evaluate/route'
import {
  TRADE_HUB_SIDE_LABELS,
  tradeHubAnalyzeSides,
  tradeHubQuickEvaluateSides,
  tradeSideAssetOffRoster,
} from '@/lib/legacy/tradeHubDirection'

const code = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

// The Trade Hub as a user sees it: their own team (Team A, the default) and a partner (Team B).
const USER_TEAM = { rosterId: 1, displayName: 'me', players: [{ id: '4984', name: 'Josh Allen', pos: 'QB', team: 'BUF' }], starters: ['4984'] }
const PARTNER = { rosterId: 2, displayName: 'them', players: [{ id: '9493', name: 'Puka Nacua', pos: 'WR', team: 'LAR' }], starters: ['9493'] }

// Exactly what the page's `buildQuickAssets` makes of "Allen picked on Team A, Puka on Team B".
const MINE_QUICK = [{ type: 'player', name: 'Josh Allen', pos: 'QB', team: 'BUF', id: '4984' }]
const PARTNER_QUICK = [{ type: 'player', name: 'Puka Nacua', pos: 'WR', team: 'LAR', id: '9493' }]
// And what `buildSide` makes of it for the full analyzer.
const MINE_SIDE = [{ type: 'player', player: { id: '4984', name: 'Josh Allen', pos: 'QB', team: 'BUF' } }]
const PARTNER_SIDE = [{ type: 'player', player: { id: '9493', name: 'Puka Nacua', pos: 'WR', team: 'LAR' } }]

const GRADE = {
  graded: true as const, letter: 'B' as const, partnerLetter: 'C' as const, label: 'Slightly favors you',
  recommendation: 'Send it.', giveValue: 7000, getValue: 9000, basis: 'Dynasty · 1QB · 12 teams · PPR',
}

function post(body: unknown) {
  return (POST as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest('http://localhost/api/legacy/trade/quick-evaluate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  mockCreateGrader.mockReset()
  mockGradeOf.mockReset()
  mockGradeOf.mockResolvedValue(GRADE)
  mockCreateGrader.mockResolvedValue(mockGradeOf)
})

describe('Trade Hub direction — the request builders', () => {
  it('Quick evaluate: the user’s own list is what they GIVE, the partner’s what they GET', () => {
    expect(tradeHubQuickEvaluateSides({ mine: MINE_QUICK, partner: PARTNER_QUICK })).toEqual({
      assetsYouGive: MINE_QUICK,
      assetsYouGet: PARTNER_QUICK,
    })
  })

  it('full analyzer: Team A (the user) RECEIVES assetsA = the partner’s list, GIVES assetsB = their own', () => {
    expect(tradeHubAnalyzeSides({ mine: MINE_SIDE, partner: PARTNER_SIDE })).toEqual({ assetsA: PARTNER_SIDE, assetsB: MINE_SIDE })
  })
})

describe('Trade Hub direction — Quick evaluate grades the user’s side', () => {
  const body = () => ({
    ...tradeHubQuickEvaluateSides({ mine: MINE_QUICK, partner: PARTNER_QUICK }),
    yourRoster: USER_TEAM.players,
    theirRoster: PARTNER.players,
    yourStarters: USER_TEAM.starters,
    theirStarters: PARTNER.starters,
    rosterPositions: ['QB', 'WR'],
    numTeams: 12,
    leagueId: 'sleeper-league-1',
  })

  it('the grader is handed give = the player the user picked on their own team, get = the partner’s', async () => {
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(mockGradeOf).toHaveBeenCalledTimes(1)
    const [give, get] = mockGradeOf.mock.calls[0]!
    expect(give).toEqual({ assets: [{ kind: 'player', name: 'Josh Allen' }], unpriceable: [] })
    expect(get).toEqual({ assets: [{ kind: 'player', name: 'Puka Nacua' }], unpriceable: [] })
  })

  it('the lineup slot map sends the user’s player out and brings the partner’s in', async () => {
    const data = await (await post(body())).json()
    const bySlot = Object.fromEntries((data.slotMap.deltas as Array<{ slot: string; beforePlayer?: string; afterPlayer?: string }>).map((d) => [d.slot, d]))
    expect(bySlot.QB?.beforePlayer).toBe('Josh Allen')
    expect(bySlot.QB?.afterPlayer).not.toBe('Josh Allen')
    expect(bySlot.WR?.afterPlayer).toBe('Puka Nacua')
  })
})

describe('Trade Hub direction — the full analyzer’s league-mode roster check', () => {
  const rosters = { rosterA: USER_TEAM.players, rosterB: PARTNER.players }

  it('accepts the Trade Hub deal in the contract’s orientation', () => {
    expect(tradeSideAssetOffRoster({ ...tradeHubAnalyzeSides({ mine: MINE_SIDE, partner: PARTNER_SIDE }), ...rosters })).toBeNull()
  })

  it('refuses the inverted deal (Team A “receiving” a player already on Team A’s roster)', () => {
    expect(tradeSideAssetOffRoster({ assetsA: MINE_SIDE, assetsB: PARTNER_SIDE, ...rosters })).toMatch(/Side A receives "Josh Allen" \(4984\)/)
  })

  it('a typed-in player with no id is not checked', () => {
    expect(tradeSideAssetOffRoster({ assetsA: [{ type: 'player', player: { name: 'Someone' } }], assetsB: MINE_SIDE, ...rosters })).toBeNull()
  })
})

describe('Trade Hub direction — the page and the analyzer route are wired to it', () => {
  const page = code('app/af-legacy/page.tsx')
  const analyze = code('server/api-route-modules/legacy/trade/analyze/route.ts')

  const QUICK_WIRED = /\.\.\.tradeHubQuickEvaluateSides\(\{\s*mine: buildQuickAssets\(tradeHubPlayersA, tradeHubPicksA, tradeHubFaabA, teamA\),\s*partner: buildQuickAssets\(tradeHubPlayersB, tradeHubPicksB, tradeHubFaabB, teamB\),?\s*\}\)/
  const ANALYZE_WIRED = /\.\.\.tradeHubAnalyzeSides\(\{ mine: sideA, partner: sideB \}\)/
  const SIDE_A_IS_TEAM_A = /const sideA = buildSide\(tradeHubPlayersA, tradeHubPicksA, tradeHubFaabA, teamA\)/
  const MINE_PANEL = /\{TRADE_HUB_SIDE_LABELS\.mine\.teamLabel\}<\/label>\s*<select\s*value=\{tradeHubTeamA\}/
  const PARTNER_PANEL = /\{TRADE_HUB_SIDE_LABELS\.partner\.teamLabel\}<\/label>\s*<select\s*value=\{tradeHubTeamB\}/
  const COUNTER_GIVE_TO_A = /const addCounterCandidateToGive = \(playerId: string\) => \{\s*if \(!playerId\) return\s*setTradeHubPlayersA\(/

  it('the labels read the right way round', () => {
    expect(TRADE_HUB_SIDE_LABELS.mine.title).toBe('You Give')
    expect(TRADE_HUB_SIDE_LABELS.partner.title).toBe('You Get')
  })

  it('Team A defaults to the user’s own roster and prints the “You Give” labels; Team B the “You Get” ones', () => {
    expect(page).toMatch(/setTradeHubTeamA\(String\(userTeam\.rosterId\)\)/)
    expect(page).toMatch(/text-cyan-400">\{TRADE_HUB_SIDE_LABELS\.mine\.title\}<\/span>/)
    expect(page).toMatch(/text-purple-400">\{TRADE_HUB_SIDE_LABELS\.partner\.title\}<\/span>/)
    expect(page).toMatch(MINE_PANEL)
    expect(page).toMatch(PARTNER_PANEL)
  })

  it('both requests send Team A’s list as what the user gives', () => {
    expect(page).toMatch(QUICK_WIRED)
    expect(page).toMatch(SIDE_A_IS_TEAM_A)
    expect(page).toMatch(ANALYZE_WIRED)
    expect(page).not.toMatch(/assetsYouGet: buildQuickAssets\(tradeHubPlayersA/)
    expect(page).not.toMatch(/assetsA: sideA,/)
  })

  it('a counter’s “add to what you give” lands on Team A', () => {
    expect(page).toMatch(COUNTER_GIVE_TO_A)
  })

  it('the analyzer grades give = assetsB (what Team A sends) and checks rosters in the same orientation', () => {
    expect(analyze).toMatch(/give: gradeInputsFromLegacyAssets\(assetsB as never\[\], numTeams\),\s*get: gradeInputsFromLegacyAssets\(assetsA as never\[\], numTeams\)/)
    expect(analyze).toMatch(/tradeSideAssetOffRoster\(\{\s*assetsA: assetsARaw,\s*assetsB: assetsBRaw,\s*rosterA: clientRosterA,\s*rosterB: clientRosterB,?\s*\}\)/)
    expect(analyze).not.toMatch(/rosterAIds\.has\(/)
  })

  it('positive controls: each wiring shape rejects the code it replaced', () => {
    expect(QUICK_WIRED.test('...tradeHubQuickEvaluateSides({\n mine: buildQuickAssets(tradeHubPlayersB, tradeHubPicksB, tradeHubFaabB, teamB),\n partner: buildQuickAssets(tradeHubPlayersA, tradeHubPicksA, tradeHubFaabA, teamA),\n})')).toBe(false)
    expect(ANALYZE_WIRED.test('...tradeHubAnalyzeSides({ mine: sideB, partner: sideA })')).toBe(false)
    expect(MINE_PANEL.test('{TRADE_HUB_SIDE_LABELS.mine.teamLabel}</label>\r\n  <select\r\n  value={tradeHubTeamB}')).toBe(false)
    expect(COUNTER_GIVE_TO_A.test('const addCounterCandidateToGive = (playerId: string) => {\r\n    if (!playerId) return\r\n    setTradeHubPlayersB(prev => {')).toBe(false)
    expect(MINE_PANEL.test('{TRADE_HUB_SIDE_LABELS.mine.teamLabel}</label>\r\n  <select\r\n  value={tradeHubTeamA}')).toBe(true)
  })
})
