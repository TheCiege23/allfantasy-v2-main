/**
 * Dynasty detail polish: pick chips on the native trade screen, taxi badges on the lineup, the
 * rookie-draft lottery on the standings, and the season clock on the history tab. Each one is drawn
 * for a dynasty league only; the non-dynasty half of every test pins that the old render stands.
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/hooks/useLeagueRealtimeRefresh', () => ({ useLeagueRealtimeRefresh: () => undefined }))
vi.mock('@/hooks/useVisibleRefresh', () => ({ useVisibleRefresh: () => undefined }))
vi.mock('@/lib/league/lineup-lock', () => ({ evaluateLineupLock: () => ({ locked: false, policy: 'football_weekly' }) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: () => undefined }))
vi.mock('@/app/league/[leagueId]/tabs/ProposeTradeModal', () => ({ ProposeTradeModal: () => null }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/league/SeasonDetailView', () => ({ SeasonDetailView: () => null }))
vi.mock('@/components/league/SeasonRecapView', () => ({ SeasonRecapView: () => null }))
vi.mock('@/components/league/HistoricalDraftBoard', () => ({ HistoricalDraftBoard: ({ season }: { season: number }) => <div data-testid="rookie-board">board {season}</div> }))
vi.mock('recharts', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return { Bar: Box, BarChart: Box, Cell: Box, ResponsiveContainer: Box, Tooltip: Box, XAxis: Box, YAxis: Box }
})

import {
  dynastyYearOf,
  firstSeasonOf,
  isRookieByExperience,
  pickChipFromTradeItem,
  pickChipLabel,
  pickChipViaRosterId,
  taxiSeasonOf,
} from '@/lib/dynasty-core/dynastyDetails'
import { NativeTradesScreen } from '@/components/league/native/screens/NativeTradesScreen'
import { NativeLineupScreen } from '@/components/league/native/screens/NativeLineupScreen'
import { NativeStandingsScreen } from '@/components/league/native/screens/NativeStandingsScreen'
import { DynastyLotteryCard, lotteryOrderKey } from '@/components/dynasty/DynastyLotteryCard'
import { HistoryTab } from '@/app/league/[leagueId]/tabs/HistoryTab'
import { fireEvent } from '@testing-library/react'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(routes: Record<string, unknown>) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const key = Object.keys(routes).find((k) => url.includes(k))
      if (!key) return new Response(JSON.stringify({ error: 'nope' }), { status: 404 })
      return new Response(JSON.stringify(routes[key]), { status: 200 })
    }),
  )
  return calls
}

const base = { id: 'lg1', name: 'Blah', sport: 'NFL', season: 2026, currentWeek: 5, teamCount: 4, platform: 'allfantasy', settings: {} }
const dynastyLeague = { ...base, format: 'dynasty', isDynasty: true, leagueType: 'dynasty' } as unknown as UserLeague
const redraftLeague = { ...base, format: 'redraft', isDynasty: false, leagueType: 'redraft' } as unknown as UserLeague

describe('dynastyDetails readers', () => {
  it('reads a future pick, a current-draft pick and a metadata-only pick; refuses non-picks', () => {
    expect(pickChipFromTradeItem({ itemType: 'future_pick', itemReference: 'fdp:2027:1:rosA', fromRosterId: 'rosB' })).toEqual({ season: 2027, round: 1, originalRosterId: 'rosA', fromRosterId: 'rosB' })
    expect(pickChipFromTradeItem({ itemType: 'rookie_pick', itemReference: 'rdp:sess:2:rosC', fromRosterId: 'rosC' })).toEqual({ season: null, round: 2, originalRosterId: 'rosC', fromRosterId: 'rosC' })
    expect(pickChipFromTradeItem({ itemType: 'rookie_pick', itemReference: 'legacy', metadata: { season: '2028', round: 3 } })).toEqual({ season: 2028, round: 3, originalRosterId: null, fromRosterId: null })
    expect(pickChipFromTradeItem({ itemType: 'rookie_pick', itemReference: 'legacy', metadata: { label: '2028 3rd' } })).toBeNull()
    expect(pickChipFromTradeItem({ itemType: 'player', itemReference: 'fdp:2027:1:rosA' })).toBeNull()
  })

  it('names a "via" only for a pick sent by a team other than its original owner', () => {
    expect(pickChipViaRosterId({ originalRosterId: 'a', fromRosterId: 'b' })).toBe('a')
    expect(pickChipViaRosterId({ originalRosterId: 'a', fromRosterId: 'a' })).toBeNull()
    expect(pickChipViaRosterId({ originalRosterId: 'a', fromRosterId: null })).toBeNull()
    expect(pickChipLabel({ season: 2027, round: 1 })).toBe('2027 R1')
    expect(pickChipLabel({ season: null, round: 2 })).toBe('R2')
  })

  it('counts the taxi season being played, and nothing when the league sets no limit', () => {
    expect(taxiSeasonOf(0, 2)).toEqual({ season: 1, of: 2 })
    expect(taxiSeasonOf(1, 3)).toEqual({ season: 2, of: 3 })
    expect(taxiSeasonOf(5, 2)).toEqual({ season: 2, of: 2 })
    expect(taxiSeasonOf(0, null)).toBeNull()
    expect(isRookieByExperience(0)).toBe(true)
    expect(isRookieByExperience(undefined)).toBe(false)
    expect(isRookieByExperience(1)).toBe(false)
  })

  it('derives Year N from the earliest season on file', () => {
    const first = firstSeasonOf([{ season: 2025 }, { season: 2023 }, { season: 2024 }])
    expect(first).toBe(2023)
    expect(dynastyYearOf(2025, first)).toBe(3)
    expect(dynastyYearOf(2023, first)).toBe(1)
    expect(dynastyYearOf(2022, first)).toBeNull()
    expect(dynastyYearOf(2025, null)).toBeNull()
    expect(firstSeasonOf([])).toBeNull()
  })
})

const pickOffer = {
  id: 't1', direction: 'incoming', partnerName: 'Open Team 5', timestamp: new Date().toISOString(), status: 'pending', viewerIsReceiver: true,
  sent: [{ id: 'a', label: 'fdp:2027:1:rosC', sublabel: null, headshotUrl: null, accent: 'blue', pick: { season: 2027, round: 1, originalRosterId: 'rosC', fromRosterId: 'rosMe' } }],
  received: [{ id: 'b', label: 'fdp:2028:2:rosP', sublabel: null, headshotUrl: null, accent: 'teal', pick: { season: 2028, round: 2, originalRosterId: 'rosP', fromRosterId: 'rosP' } }],
}
const teams = [{ id: 'lt3', externalId: 'rosC', teamName: 'Cobras' }] as never

describe('NativeTradesScreen pick chips', () => {
  it('a dynasty league draws each pick as a chip: R1 gold, a later round plain, "via" the original team', async () => {
    stubFetch({ '/api/league/trades-panel': { activeTrades: [pickOffer], historyTrades: [], tradeBlock: [] } })
    render(<NativeTradesScreen league={dynastyLeague} teams={teams} />)
    const chips = await screen.findAllByTestId('dynasty-pick-chip')
    expect(chips.map((c) => c.getAttribute('data-round'))).toEqual(['1', '2'])
    expect(chips[0]!.textContent).toContain('2027 R1')
    expect(chips[0]!.textContent).toContain('via Cobras')
    expect(chips[1]!.textContent).toContain('2028 R2')
    expect(chips[1]!.textContent).not.toContain('via')
    expect(screen.queryByText('fdp:2027:1:rosC')).toBeNull()
  })

  it('a redraft league keeps the plain label', async () => {
    stubFetch({ '/api/league/trades-panel': { activeTrades: [pickOffer], historyTrades: [], tradeBlock: [] } })
    render(<NativeTradesScreen league={redraftLeague} teams={teams} />)
    expect(await screen.findByText('fdp:2027:1:rosC')).toBeTruthy()
    expect(screen.queryByTestId('dynasty-pick-chip')).toBeNull()
  })
})

const wire = (id: string, name: string, position: string, yearsExp: number | null) => ({
  id, name, position, team: 'PHI', sport: 'NFL', headshotUrl: null, imageUrl: null, teamLogoUrl: null, injuryStatus: null,
  fantasyPointsPerGame: null, projectedPoints: 5, adp: null, aiAdp: null, aiAdpSampleSize: null, collegeClass: '', collegeClassLabel: null,
  soccerLeague: null, nflRookieIsRookie: null, nflRookieSource: null, lowConfidence: false, profileSource: null, statsSource: null,
  projectionsSource: null, normalizedStats: {}, normalizedProjections: {}, product: { unified: {}, yearsExp },
})
const taxiRoster = (taxiTenure: unknown) => ({
  rosterId: 'ros1', leagueWeek: 5, canEditLineup: true, faabRemaining: 86,
  starterSlots: [{ index: 0, label: 'QB', allowedPositions: ['QB'], isFlexible: false }],
  slotLimits: { starters: 1, bench: 3, ir: 0, taxi: 3, devy: 0 },
  roster: { lineup_sections: { starters: [{ id: 'qb1' }], bench: [], ir: [], taxi: [{ id: 'tx1' }, { id: 'tx2' }], devy: [] } },
  unifiedRoster: [wire('qb1', 'Jalen Hurts', 'QB', 6), wire('tx1', 'Rookie Back', 'RB', 0), wire('tx2', 'Second Year', 'WR', 1)],
  taxiTenure,
})
const lineupTeam = { id: 't', teamName: 'Mine', wins: 3, losses: 1, ties: 0, pointsFor: 478.6, currentRank: 2 } as never
const lineupRoutes = (r: unknown) => ({ '/api/league/roster': r, '/claims': { claims: [] }, '/state': { state: {} }, '/settings': { waiverType: 'faab', faabBudget: 100 } })

describe('NativeLineupScreen taxi badges', () => {
  it('a dynasty taxi row shows Rookie from real experience and which taxi season this is', async () => {
    stubFetch(lineupRoutes(taxiRoster({ maxYears: 2, seasonsUsed: { tx2: 1 } })))
    render(<NativeLineupScreen league={dynastyLeague} userTeam={lineupTeam} onSelectTab={() => {}} />)
    await screen.findByText('Rookie Back')
    const rookies = screen.getAllByTestId('taxi-rookie-badge')
    expect(rookies).toHaveLength(1)
    expect(rookies[0]!.closest('li')!.textContent).toContain('Rookie Back')
    expect(screen.getAllByTestId('taxi-season-badge').map((b) => b.textContent)).toEqual(['Taxi 1/2', 'Taxi 2/2'])
    expect(screen.getByText('Taxi squad')).toBeTruthy()
  })

  it('no limit means no season badge; a redraft league draws no badge at all', async () => {
    stubFetch(lineupRoutes(taxiRoster({ maxYears: null, seasonsUsed: {} })))
    const { unmount } = render(<NativeLineupScreen league={dynastyLeague} userTeam={lineupTeam} onSelectTab={() => {}} />)
    await screen.findByText('Rookie Back')
    expect(screen.queryByTestId('taxi-season-badge')).toBeNull()
    expect(screen.getAllByTestId('taxi-rookie-badge')).toHaveLength(1)
    unmount()
    stubFetch(lineupRoutes(taxiRoster({ maxYears: 2, seasonsUsed: {} })))
    render(<NativeLineupScreen league={redraftLeague} userTeam={lineupTeam} onSelectTab={() => {}} />)
    await screen.findByText('Rookie Back')
    expect(screen.queryByTestId('taxi-rookie-badge')).toBeNull()
    expect(screen.queryByTestId('taxi-season-badge')).toBeNull()
  })
})

const lottery = {
  available: true,
  data: {
    pickCount: 3, playoffTeamCount: 2, fallbackOrder: 'reverse order of finish', fallbackMode: 'reverse_max_pf', alreadyRunAt: null,
    teams: [
      { rosterId: 'r4', name: 'Open Team 4', record: '0-4', oddsPercent: 50, isYou: false },
      { rosterId: 'r3', name: 'Open Team 5', record: '1-3', oddsPercent: 33.3, isYou: true },
      { rosterId: 'r2', name: 'Open Team 9', record: '3-1', oddsPercent: 16.7, isYou: false },
    ],
  },
}
const standings = {
  season: 2026, scoredWeeks: 4, viewerRosterId: 'r3',
  standings: [
    { rosterId: 'r1', teamName: 'Open Team 1', wins: 4, losses: 0, ties: 0, pointsFor: 512.3, pointsAgainst: 401.7, rank: 1 },
    { rosterId: 'r3', teamName: 'Open Team 5', wins: 1, losses: 3, ties: 0, pointsFor: 400, pointsAgainst: 433.9, rank: 3 },
  ],
}

describe('Standings rookie-draft lottery', () => {
  it('a dynasty league shows Draft HQ’s odds with the viewer’s row marked', async () => {
    const calls = stubFetch({ '/scoring/standings': standings, '/draft-lottery/odds': { lottery } })
    render(<NativeStandingsScreen league={dynastyLeague} isCommissioner={false} onSelectTab={() => {}} />)
    const card = await screen.findByTestId('dynasty-lottery-card')
    expect(calls.some((u) => u.includes('/api/leagues/lg1/draft-lottery/odds'))).toBe(true)
    expect(card.textContent).toContain('Rookie draft lottery')
    expect(card.textContent).toContain('50.0%')
    expect(screen.getByTestId('dynasty-lottery-row-r3').getAttribute('data-you')).toBe('true')
    expect(card.textContent).toContain('reverse order of max points for outside the playoffs')
    expect(screen.getByRole('button', { name: /Ask Chimmy about my pick/ })).toBeTruthy()
  })

  it('a redraft league never asks for lottery odds', async () => {
    const calls = stubFetch({ '/scoring/standings': standings, '/draft-lottery/odds': { lottery } })
    render(<NativeStandingsScreen league={redraftLeague} isCommissioner={false} onSelectTab={() => {}} />)
    await screen.findByText('Open Team 1')
    expect(calls.some((u) => u.includes('/draft-lottery/odds'))).toBe(false)
    expect(screen.queryByTestId('dynasty-lottery-card')).toBeNull()
  })

  it('an unavailable lottery draws nothing', async () => {
    stubFetch({ '/draft-lottery/odds': { lottery: { available: false, reason: 'not a lottery league' } } })
    const { container } = render(<DynastyLotteryCard leagueId="lg1" leagueName="Blah" />)
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1))
    expect(container.innerHTML).toBe('')
  })

  it('words the order after the drawn picks from the stored fallback', () => {
    expect(lotteryOrderKey('reverse_standings')).toBe('dynasty.lottery.order.reverse_standings')
    expect(lotteryOrderKey('manual')).toBe('dynasty.lottery.order.reverse_standings')
    expect(lotteryOrderKey('reverse_max_pf')).toBe('dynasty.lottery.order.reverse_max_pf')
    expect(lotteryOrderKey('')).toBe('dynasty.lottery.order.unknown')
  })
})

const history = {
  seasons: [
    { id: 's25', season: 2025, teamCount: 4, scoringFormat: 'PPR', championName: 'Cobras', championAvatar: null, runnerUpName: 'Hawks', teamRecords: [{ rank: 1, wins: 9, managerName: 'Cobras', pointsFor: 1500 }] },
    { id: 's24', season: 2024, teamCount: 4, scoringFormat: 'PPR', championName: 'Hawks', championAvatar: null, runnerUpName: null, teamRecords: [] },
  ],
  allTimeStandings: [{ managerKey: 'm1', managerName: 'Cobras', managerAvatar: null, yearRange: '2024–2025', totalWins: 18, totalLosses: 8, totalTies: 0, winPct: 0.69, avgPointsPerSeason: 1500, championships: 1, runnerUps: 1 }],
}

describe('HistoryTab dynasty details', () => {
  it('a dynasty league shows the season clock, lucide icons and each season’s rookie draft', async () => {
    stubFetch({ '/history': history })
    render(<HistoryTab league={dynastyLeague} />)
    const clocks = await screen.findAllByTestId('history-season-clock')
    expect(clocks.map((c) => c.textContent)).toEqual(['Year 2 · 2025', 'Year 1 · 2024'])
    expect(document.body.textContent).not.toMatch(/[🏆🥈📊]/u)
    fireEvent.click(screen.getAllByTestId('history-rookie-draft-toggle')[0]!)
    expect(screen.getByTestId('rookie-board').textContent).toBe('board 2025')
  })

  it('a redraft league keeps its season pill and emoji, with no rookie-draft toggle', async () => {
    stubFetch({ '/history': history })
    render(<HistoryTab league={redraftLeague} />)
    await screen.findByText('Cobras', { selector: 'p' })
    expect(screen.queryByTestId('history-season-clock')).toBeNull()
    expect(screen.queryByTestId('history-rookie-draft-toggle')).toBeNull()
    expect(document.body.textContent).toContain('🏆 2025 Champion')
  })
})

describe('dynasty detail strings', () => {
  it('every new key has English and Spanish, with matching placeholders and no «waiver» in Spanish', async () => {
    const { translations } = await import('@/lib/i18n/translations')
    const keys = Object.keys(translations.en).filter((k) => /^dynasty\.(pickChip|lineup|badge|lottery|history)\./.test(k))
    expect(keys.length).toBe(25)
    const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    for (const k of keys) {
      const es = translations.es[k]
      expect(es, k).toBeTruthy()
      expect(es, k).not.toMatch(/waiver/i)
      expect(ph(es!), k).toEqual(ph(translations.en[k]!))
    }
  })
})
