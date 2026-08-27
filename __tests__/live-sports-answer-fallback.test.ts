import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const xaiResponsesJsonMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/xai-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/xai-client')>('@/lib/xai-client')
  return {
    ...actual,
    xaiResponsesJson: xaiResponsesJsonMock,
  }
})

import {
  answerSportsQuestionFromSearch,
  isSearchableSportsQuestion,
} from '@/lib/ai/liveSportsAnswer'

/** An xAI Responses payload carrying text plus `url_citation` annotations. */
function payload(text: string, urls: Array<{ url: string; title?: string }>) {
  return {
    ok: true as const,
    status: 200,
    json: {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text,
              annotations: urls.map((u) => ({
                type: 'url_citation',
                url_citation: { url: u.url, title: u.title },
              })),
            },
          ],
        },
      ],
    },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('isSearchableSportsQuestion', () => {
  it('accepts a public factual question', () => {
    expect(isSearchableSportsQuestion('how many HRs were hit in the majors yesterday?')).toBe(true)
    expect(isSearchableSportsQuestion('when does the college football season start?')).toBe(true)
  })

  /*
   * ⚠ THE IMPORTANT EXCLUSION. A web search knows nothing about this user's
   * roster or scoring settings, so an advice answer built from it would read
   * exactly like a grounded recommendation while being based on somebody
   * else's rankings. Advice stays on the pipeline that has the league.
   */
  it('refuses advice questions, which search cannot honestly answer', () => {
    for (const q of [
      'who should I start this week?',
      'should I trade for Bijan Robinson?',
      'who is on waivers to pick up?',
      'is it worth dropping my kicker?',
      'start or sit Josh Allen?',
    ]) {
      expect(isSearchableSportsQuestion(q), q).toBe(false)
    }
  })

  it('ignores empty and trivially short input', () => {
    expect(isSearchableSportsQuestion('')).toBe(false)
    expect(isSearchableSportsQuestion('hi')).toBe(false)
  })
})

describe('answerSportsQuestionFromSearch', () => {
  it('returns the answer with its sources when the search cited something', async () => {
    xaiResponsesJsonMock.mockResolvedValue(
      payload('There were 41 home runs hit across MLB on August 26, 2026.', [
        { url: 'https://www.mlb.com/scores/2026-08-26', title: 'MLB Scores' },
      ]),
    )

    const result = await answerSportsQuestionFromSearch(
      'how many HRs were hit in the majors yesterday?',
    )

    expect(result?.text).toContain('41 home runs')
    expect(result?.citations).toEqual([
      { label: 'MLB Scores', url: 'https://www.mlb.com/scores/2026-08-26' },
    ])
  })

  /*
   * ⚠ THE GATE, AND THE WHOLE REASON THIS PATH IS ALLOWED TO EXIST. Confident
   * prose with no source is the model answering from memory — indistinguishable
   * from the hallucination the refusals exist to prevent. It gets discarded so
   * the caller keeps its honest refusal.
   */
  it('discards a confident answer that cites nothing', async () => {
    xaiResponsesJsonMock.mockResolvedValue(
      payload('There were definitely 41 home runs hit yesterday.', []),
    )

    expect(
      await answerSportsQuestionFromSearch('how many HRs were hit in the majors yesterday?'),
    ).toBeNull()
  })

  it('falls back to the hostname when a citation has no title', async () => {
    xaiResponsesJsonMock.mockResolvedValue(
      payload('Week 1 starts September 3.', [{ url: 'https://www.espn.com/nfl/schedule' }]),
    )

    const result = await answerSportsQuestionFromSearch('when does the NFL season start?')

    expect(result?.citations[0]).toEqual({
      label: 'espn.com',
      url: 'https://www.espn.com/nfl/schedule',
    })
  })

  it('de-duplicates repeated source URLs', async () => {
    xaiResponsesJsonMock.mockResolvedValue(
      payload('Something happened.', [
        { url: 'https://example.com/a', title: 'A' },
        { url: 'https://example.com/a', title: 'A again' },
        { url: 'https://example.com/b', title: 'B' },
      ]),
    )

    const result = await answerSportsQuestionFromSearch('what was the final score last night?')

    expect(result?.citations.map((c) => c.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
  })

  it('drops non-http citation values rather than rendering them', async () => {
    xaiResponsesJsonMock.mockResolvedValue(
      payload('Something happened.', [
        { url: 'javascript:alert(1)', title: 'bad' },
        { url: 'https://example.com/ok', title: 'ok' },
      ]),
    )

    const result = await answerSportsQuestionFromSearch('what was the final score last night?')

    expect(result?.citations).toEqual([{ label: 'ok', url: 'https://example.com/ok' }])
  })

  /* Every failure is the same outcome: the caller keeps its refusal. */
  it('returns null on a provider error', async () => {
    xaiResponsesJsonMock.mockResolvedValue({ ok: false, status: 503, details: 'no key' })
    expect(await answerSportsQuestionFromSearch('how many HRs yesterday?')).toBeNull()
  })

  it('returns null when the provider throws, including a disabled kill switch', async () => {
    xaiResponsesJsonMock.mockRejectedValue(new Error('AI provider spend is disabled'))
    expect(await answerSportsQuestionFromSearch('how many HRs yesterday?')).toBeNull()
  })

  it('returns null on empty text even if sources came back', async () => {
    xaiResponsesJsonMock.mockResolvedValue(
      payload('   ', [{ url: 'https://example.com/a', title: 'A' }]),
    )
    expect(await answerSportsQuestionFromSearch('how many HRs yesterday?')).toBeNull()
  })

  it('never calls the provider for an advice question', async () => {
    expect(await answerSportsQuestionFromSearch('who should I start at flex?')).toBeNull()
    expect(xaiResponsesJsonMock).not.toHaveBeenCalled()
  })

  /* Recency questions get X search as well; the rest stay on web only. */
  it('adds X search only when the question is about right now', async () => {
    xaiResponsesJsonMock.mockResolvedValue(
      payload('ok', [{ url: 'https://example.com/a', title: 'A' }]),
    )

    await answerSportsQuestionFromSearch('what is the live score right now?')
    const withRecency = xaiResponsesJsonMock.mock.calls[0][0].tools.map((t: any) => t.type)
    expect(withRecency).toContain('x_search')

    xaiResponsesJsonMock.mockClear()
    await answerSportsQuestionFromSearch('when does the college football season start?')
    const withoutRecency = xaiResponsesJsonMock.mock.calls[0][0].tools.map((t: any) => t.type)
    expect(withoutRecency).toEqual(['web_search'])
  })
})
