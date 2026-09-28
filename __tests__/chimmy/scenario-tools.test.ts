import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  trade: vi.fn(),
  startSit: vi.fn(),
  waiver: vi.fn(),
}))

vi.mock('@/lib/chimmy/tradeScenarioGrounding', () => ({
  buildTradeScenario: h.trade,
  renderTradeScenarioBlock: (s: { tag: string }) => `TRADE BLOCK ${s.tag}`,
}))
/* The builders are doubled; the PARSERS stay real, because the point is that the sentence parses. */
vi.mock('@/lib/chimmy/lineupScenarioGrounding', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chimmy/lineupScenarioGrounding')>(
    '@/lib/chimmy/lineupScenarioGrounding',
  )
  return {
    ...actual,
    buildStartSitScenario: h.startSit,
    buildWaiverScenario: h.waiver,
    renderStartSitScenarioBlock: (s: { tag: string }) => `START/SIT BLOCK ${s.tag}`,
    renderWaiverScenarioBlock: (s: { tag: string }) => `WAIVER BLOCK ${s.tag}`,
  }
})

import { runStartSitScenarioTool, runTradeScenarioTool, runWaiverScenarioTool } from '@/lib/chimmy/tools/scenarioTools'
import { extractPlayerNameCandidates, splitSides } from '@/lib/chimmy-trade/tradeSentence'
import { looksLikeStartSit, parseWaiverMove } from '@/lib/chimmy/lineupScenarioGrounding'

/**
 * The tool loop reaches the push path's scenario engines by composing the sentence those engines
 * parse. These pin the sentences — and, against the REAL parsers, that each sentence parses into the
 * move the structured arguments described.
 */

const LEAGUE = { leagueId: 'L1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.trade.mockResolvedValue({ tag: 'ok' })
  h.startSit.mockResolvedValue({ tag: 'ok' })
  h.waiver.mockResolvedValue({ tag: 'ok' })
})

describe('runTradeScenarioTool', () => {
  it('composes "give for get" and returns the engine\'s block', async () => {
    const out = await runTradeScenarioTool({ give: ["Ja'Marr Chase", '2027 1st'], get: ['Justin Jefferson'], ...LEAGUE })
    expect(out).toBe('TRADE BLOCK ok')
    expect(h.trade).toHaveBeenCalledWith({ message: "Ja'Marr Chase and 2027 1st for Justin Jefferson", leagueId: 'L1', userId: 'u1' })
  })

  /* The name extractor matches capitalised runs; lowercase names would compose a sentence with none. */
  it('title-cases names so the extractor can see them, and leaves picks alone', async () => {
    await runTradeScenarioTool({ give: ['bijan robinson'], get: ['puka nacua', '2026 2nd'], ...LEAGUE })
    const message = h.trade.mock.calls[0][0].message as string
    expect(message).toBe('Bijan Robinson for Puka Nacua and 2026 2nd')
    const sides = splitSides(message)!
    expect(extractPlayerNameCandidates(sides.left)).toEqual(['Bijan Robinson'])
    expect(extractPlayerNameCandidates(sides.right)).toEqual(['Puka Nacua'])
  })

  it('asks for the missing side instead of grading half a trade', async () => {
    expect(await runTradeScenarioTool({ give: ['Bijan Robinson'], get: [], ...LEAGUE })).toMatch(/Both sides/)
    expect(h.trade).not.toHaveBeenCalled()
  })

  it('says so when the engine does not read it as a trade', async () => {
    h.trade.mockResolvedValue(null)
    expect(await runTradeScenarioTool({ give: ['Bijan Robinson'], get: ['Puka Nacua'], ...LEAGUE })).toMatch(/do not grade it/)
  })
})

describe('runStartSitScenarioTool', () => {
  it('composes a start/sit question the real detector recognises', async () => {
    await runStartSitScenarioTool({ players: ['josh allen', 'Jalen Hurts'], ...LEAGUE })
    const message = h.startSit.mock.calls[0][0].message as string
    expect(message).toBe('start Josh Allen or Jalen Hurts')
    expect(looksLikeStartSit(message)).toBe(true)
  })

  it('points a three-player question at the optimizer', async () => {
    expect(await runStartSitScenarioTool({ players: ['A B', 'C D', 'E F'], ...LEAGUE })).toMatch(/optimize_my_lineup/)
    expect(h.startSit).not.toHaveBeenCalled()
  })
})

describe('runWaiverScenarioTool', () => {
  it('composes an add/drop the real parser splits correctly', async () => {
    await runWaiverScenarioTool({ add: 'rashod bateman', drop: 'Tank Bigsby', ...LEAGUE })
    const call = h.waiver.mock.calls[0][0]
    expect(call.message).toBe('add Rashod Bateman and drop Tank Bigsby')
    expect(call.engineClaims).toBeNull()
    expect(parseWaiverMove(call.message)).toEqual({ add: ['Rashod Bateman'], drop: ['Tank Bigsby'] })
  })

  it('needs a player to add', async () => {
    expect(await runWaiverScenarioTool({ add: '', drop: 'Tank Bigsby', ...LEAGUE })).toMatch(/A player to ADD is needed/)
    expect(h.waiver).not.toHaveBeenCalled()
  })
})

/* Chimmy's track record: a contested "A or B?" is a call; "start both" or "neither" is not. */
describe('runStartSitScenarioTool — the call it made', () => {
  const option = (playerId: string, name: string, inBestLineup: boolean) => ({
    playerId, name, position: 'WR', points: 10, inBestLineup, lineupIfStarted: 100,
  })
  const ready = (contested: boolean) => ({
    tag: 'ready',
    kind: 'start_sit',
    status: 'ready',
    options: [option('4046', 'Jayden Reed', true), option('8150', 'Rashid Shaheed', !contested)],
    week: { season: '2026', week: 4 },
    contested,
    startPlayerId: contested ? '4046' : null,
  })

  it('reports the pick and the player it was picked over', async () => {
    h.startSit.mockResolvedValue(ready(true))
    const onStartCall = vi.fn()
    await runStartSitScenarioTool({ players: ['Jayden Reed', 'Rashid Shaheed'], ...LEAGUE, onStartCall })
    expect(onStartCall).toHaveBeenCalledWith({
      leagueId: 'L1',
      season: 2026,
      week: 4,
      rec: { key: '4046', name: 'Jayden Reed' },
      alt: { key: '8150', name: 'Rashid Shaheed' },
      slot: null,
    })
  })

  it('reports nothing when the scenario picks nobody, or was not computed', async () => {
    const onStartCall = vi.fn()
    h.startSit.mockResolvedValue(ready(false))
    await runStartSitScenarioTool({ players: ['Jayden Reed', 'Rashid Shaheed'], ...LEAGUE, onStartCall })
    h.startSit.mockResolvedValue({ tag: 'x', kind: 'start_sit', status: 'unresolved', reason: 'unpriced_player', detail: 'no projection' })
    await runStartSitScenarioTool({ players: ['Jayden Reed', 'Rashid Shaheed'], ...LEAGUE, onStartCall })
    expect(onStartCall).not.toHaveBeenCalled()
  })
})
