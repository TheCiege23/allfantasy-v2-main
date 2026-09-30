import { beforeEach, describe, expect, it, vi } from 'vitest'

const PLAY = '2026-09-27T18:00:00.000Z'
const NOW = new Date('2026-09-27T18:07:00.000Z')
const idAt = (iso: string) => ((BigInt(new Date(iso).getTime()) - 1288834974657n) << 22n).toString()
const CLIP = `https://x.com/Chiefs/status/${idAt('2026-09-27T18:03:00.000Z')}`

const store = new Map<string, unknown>()
const xai = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) =>
        store.has(where.cacheKey) ? { data: store.get(where.cacheKey), expiresAt: new Date(Date.now() + 1e9) } : null),
      findMany: vi.fn(async ({ where }: { where: { cacheKey: { in: string[] } } }) =>
        where.cacheKey.in.filter((k) => store.has(k)).map((k) => ({ cacheKey: k, data: store.get(k) }))),
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => {
        store.set(where.cacheKey, JSON.parse(JSON.stringify(create.data)))
      }),
    },
    sportsGame: { findFirst: vi.fn(async () => ({ homeTeam: 'BUF', awayTeam: 'KC' })) },
  },
}))

const touchdown = (key: string, playerId: string, detectedAt = PLAY) => ({
  gameId: 'ri-1', playerId, playerName: `Player ${playerId}`, team: null, type: 'TOUCHDOWN',
  stat: 'pass', delta: 1, value: 1, detectedAt, idempotencyKey: key, detail: 'TD',
})
let feed: ReturnType<typeof touchdown>[] = []

vi.mock('@/lib/live/playByPlayFeed', () => ({ readPlayByPlayFeed: vi.fn(async () => feed) }))
vi.mock('@/lib/live/playFeedPresentation', () => ({
  getPlayFeed: vi.fn(async () => feed.map((e) => ({ id: e.idempotencyKey, team: 'KC', headline: `${e.playerName} 12-yard TD` }))),
}))
// Player "started" is in someone's lineup; player "bench" is not.
vi.mock('@/lib/live/bigPlayNotifier', () => ({
  ownersByPlayerId: vi.fn(async (ids: string[]) => new Map(ids.filter((i) => i === 'started').map((i) => [i, ['user-1']]))),
}))
vi.mock('@/lib/xai-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/xai-client')>()
  return { ...real, xaiResponsesJson: (...args: unknown[]) => xai(...args) }
})

function xaiAnswer(pick: string | null, citations: string[]) {
  return {
    ok: true,
    status: 200,
    json: {
      model: 'grok-test',
      usage: { cost_in_usd_ticks: 1234 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ postUrl: pick, reason: 'r' }), annotations: citations.map((url) => ({ type: 'url_citation', url })) }] }],
    },
  }
}

const { runGrokTdClipPilot, recordKey } = await import('@/lib/live/grokTdClipPilot')

beforeEach(() => {
  store.clear()
  xai.mockReset()
  feed = []
  process.env.GROK_TD_CLIP_PILOT = '1'
  delete process.env.GROK_TD_CLIP_PILOT_MAX_PER_RUN
  delete process.env.GROK_TD_CLIP_PILOT_DAILY_CAP
})

describe('runGrokTdClipPilot', () => {
  it('spends nothing unless the pilot flag is on', async () => {
    delete process.env.GROK_TD_CLIP_PILOT
    feed = [touchdown('td-1', 'started')]
    const r = await runGrokTdClipPilot({ now: NOW })
    expect(r.skipped).toBe('disabled')
    expect(xai).not.toHaveBeenCalled()
  })

  it('searches only touchdowns someone starts, restricted to the league and both teams', async () => {
    feed = [touchdown('td-1', 'started'), touchdown('td-2', 'bench')]
    xai.mockResolvedValue(xaiAnswer(CLIP, [CLIP]))
    const r = await runGrokTdClipPilot({ now: NOW })
    expect(r).toMatchObject({ searched: 1, found: 1, errors: 0 })
    const tool = xai.mock.calls[0]![0].tools[0]
    expect(tool.type).toBe('x_search')
    expect(tool.allowed_x_handles).toEqual(['NFL', 'Chiefs', 'BuffaloBills'])
    const rec = store.get(recordKey('td-1')) as { found: boolean; attempts: Array<{ accepted: { url: string } | null; costTicks: number }> }
    expect(rec.found).toBe(true)
    expect(rec.attempts[0]!.accepted?.url).toBe(CLIP)
    expect(rec.attempts[0]!.costTicks).toBe(1234)
    expect(store.has(recordKey('td-2'))).toBe(false)
  })

  it('logs a miss, not a hit, when the model names a post the search never returned', async () => {
    feed = [touchdown('td-1', 'started')]
    const invented = `https://x.com/NFL/status/${idAt('2026-09-27T18:04:00.000Z')}`
    xai.mockResolvedValue(xaiAnswer(invented, [CLIP]))
    const r = await runGrokTdClipPilot({ now: NOW })
    expect(r.found).toBe(0)
    const rec = store.get(recordKey('td-1')) as { found: boolean; attempts: Array<{ modelPick: string }> }
    expect(rec.found).toBe(false)
    expect(rec.attempts[0]!.modelPick).toBe(invented)
  })

  it('does not search a play that is too fresh, and respects the per-run cap', async () => {
    feed = [
      touchdown('fresh', 'started', '2026-09-27T18:05:00.000Z'),
      touchdown('a', 'started'), touchdown('b', 'started'), touchdown('c', 'started'),
    ]
    xai.mockResolvedValue(xaiAnswer(null, []))
    const r = await runGrokTdClipPilot({ now: NOW })
    expect(r.searched).toBe(2)
    expect(store.has(recordKey('fresh'))).toBe(false)
  })

  it('stops at the daily cap', async () => {
    process.env.GROK_TD_CLIP_PILOT_DAILY_CAP = '1'
    feed = [touchdown('a', 'started'), touchdown('b', 'started')]
    xai.mockResolvedValue(xaiAnswer(null, []))
    const first = await runGrokTdClipPilot({ now: NOW })
    expect(first.searched).toBe(1)
    const second = await runGrokTdClipPilot({ now: NOW })
    expect(second.skipped).toBe('daily-cap')
    expect(xai).toHaveBeenCalledTimes(1)
  })

  it('records a failed search as an error and never throws into the cron', async () => {
    feed = [touchdown('td-1', 'started')]
    xai.mockRejectedValue(new Error('socket hang up'))
    const r = await runGrokTdClipPilot({ now: NOW })
    expect(r).toMatchObject({ searched: 1, errors: 1, found: 0 })
  })

  it('stands down when AI spend is switched off, releasing its claim', async () => {
    feed = [touchdown('td-1', 'started')]
    xai.mockRejectedValue(Object.assign(new Error('off'), { code: 'ai_spend_disabled' }))
    const r = await runGrokTdClipPilot({ now: NOW })
    expect(r.skipped).toBe('ai-spend-disabled')
    const rec = store.get(recordKey('td-1')) as { claimedAt: string | null; attempts: unknown[] }
    expect(rec.claimedAt).toBeNull()
    expect(rec.attempts).toHaveLength(0)
  })
})
