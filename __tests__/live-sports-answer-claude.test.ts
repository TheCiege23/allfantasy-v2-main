import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ create: vi.fn(), xai: vi.fn(), spend: true }))
const reportProviderFailure = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ai-orchestration/providerOutageAlert', () => ({ reportProviderFailure }))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => h.spend }))
vi.mock('@/lib/xai-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/xai-client')>('@/lib/xai-client')
  return { ...actual, xaiResponsesJson: h.xai }
})
vi.mock('@anthropic-ai/sdk', () => {
  class BadRequestError extends Error {
    status = 400
  }
  class Anthropic {
    static BadRequestError = BadRequestError
    messages = { create: h.create }
    constructor(public opts: unknown) {}
  }
  return { default: Anthropic }
})

import Anthropic from '@anthropic-ai/sdk'
import { answerSportsQuestionFromSearch, claudeCitations } from '@/lib/ai/liveSportsAnswer'

const Q = 'how many HRs were hit in the majors yesterday?'

function cited(text: string, sources: Array<{ url: string; title?: string | null }>, extra: Record<string, unknown> = {}) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'MLB home runs' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [] },
      {
        type: 'text',
        text,
        citations: sources.map((s) => ({
          type: 'web_search_result_location',
          url: s.url,
          title: s.title ?? null,
          cited_text: '41 home runs',
          encrypted_index: 'x',
        })),
      },
    ],
    ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.spend = true
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key')
  vi.stubEnv('CHIMMY_CLAUDE_MODEL', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('live sports search on Claude', () => {
  it('answers with Claude web search and never touches xAI', async () => {
    h.create.mockResolvedValue(
      cited('There were 41 home runs across MLB on September 22, 2026.', [
        { url: 'https://www.mlb.com/scores/2026-09-22', title: 'MLB Scores' },
      ]),
    )

    const out = await answerSportsQuestionFromSearch(Q)

    expect(out).toEqual({
      text: 'There were 41 home runs across MLB on September 22, 2026.',
      citations: [{ label: 'MLB Scores', url: 'https://www.mlb.com/scores/2026-09-22' }],
      provider: 'claude',
      model: 'claude-opus-5',
    })
    expect(h.xai).not.toHaveBeenCalled()
  })

  it('sends the current web search tool, bounded, on Chimmy\'s Claude', async () => {
    h.create.mockResolvedValue(cited('ok', [{ url: 'https://a.example/x' }]))

    await answerSportsQuestionFromSearch(Q)

    const [params] = h.create.mock.calls[0]
    expect(params.model).toBe('claude-opus-5')
    // The BASIC tool: the newer one returned zero text citations live, which the gate would discard.
    expect(params.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }])
    expect(params.system).toContain('ONLY the search results')
  })

  /* THE GATE: prose with no citation used no search result — it is memory, and is discarded. */
  it('returns null when Claude cites nothing, however confident the prose', async () => {
    h.create.mockResolvedValue(cited('There were definitely 41 home runs.', []))
    expect(await answerSportsQuestionFromSearch(Q)).toBeNull()
  })

  it('continues a pause_turn, bounded', async () => {
    h.create
      .mockResolvedValueOnce({ model: 'claude-opus-5', stop_reason: 'pause_turn', content: [] })
      .mockResolvedValueOnce(cited('41.', [{ url: 'https://a.example/x' }]))

    const out = await answerSportsQuestionFromSearch(Q)

    expect(out?.text).toBe('41.')
    expect(h.create).toHaveBeenCalledTimes(2)
  })

  it('gives up rather than paying for an endless pause_turn', async () => {
    h.create.mockResolvedValue({ model: 'claude-opus-5', stop_reason: 'pause_turn', content: [] })
    expect(await answerSportsQuestionFromSearch(Q)).toBeNull()
    expect(h.create).toHaveBeenCalledTimes(3)
  })

  it('retries once without the fallback beta on a 400', async () => {
    h.create
      .mockRejectedValueOnce(new (Anthropic as any).BadRequestError('bad field'))
      .mockResolvedValueOnce(cited('41.', [{ url: 'https://a.example/x' }]))
    expect((await answerSportsQuestionFromSearch(Q))?.text).toBe('41.')
    expect(h.create.mock.calls[1][0].fallbacks).toBeUndefined()
  })

  it('reports an Anthropic failure and returns null', async () => {
    h.create.mockRejectedValue(Object.assign(new Error('credit balance is too low'), { status: 402 }))
    expect(await answerSportsQuestionFromSearch(Q)).toBeNull()
    expect(reportProviderFailure).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', status: 402, surface: 'chimmy_live_search' }),
    )
  })

  it('still refuses advice questions before any search', async () => {
    expect(await answerSportsQuestionFromSearch('who should I start at flex?')).toBeNull()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('never searches with AI spend disabled', async () => {
    h.spend = false
    expect(await answerSportsQuestionFromSearch(Q)).toBeNull()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('uses Grok only when there is no Anthropic key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    h.xai.mockResolvedValue({ ok: false, status: 403, details: 'no credits' })
    await answerSportsQuestionFromSearch(Q)
    expect(h.xai).toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('claudeCitations', () => {
  it('de-duplicates, skips non-web and non-http citations, and labels by host when untitled', () => {
    const out = claudeCitations([
      {
        type: 'text',
        text: 'a',
        citations: [
          { type: 'web_search_result_location', url: 'https://www.espn.com/x', title: null, cited_text: '', encrypted_index: '' },
          { type: 'web_search_result_location', url: 'https://www.espn.com/x', title: 'dup', cited_text: '', encrypted_index: '' },
          { type: 'char_location', url: 'https://nope.example', title: 'x' },
          { type: 'web_search_result_location', url: 'javascript:alert(1)', title: 'bad', cited_text: '', encrypted_index: '' },
        ],
      },
    ] as never)
    expect(out).toEqual([{ label: 'espn.com', url: 'https://www.espn.com/x' }])
  })
})
