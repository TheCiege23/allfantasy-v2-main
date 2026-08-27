import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), execute: vi.fn() }))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: h.create } }
    constructor(public opts: unknown) {}
  },
}))

vi.mock('@/lib/chimmy/tools/chimmyTools', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chimmy/tools/chimmyTools')>(
    '@/lib/chimmy/tools/chimmyTools',
  )
  return { ...actual, executeChimmyTool: h.execute }
})

import { canRunChimmyToolLoop, runChimmyToolLoop } from '@/lib/chimmy/tools/chimmyToolLoop'

const CTX = { leagueId: 'l1', userId: 'u1' }

function answer(text: string) {
  return { choices: [{ message: { role: 'assistant', content: text } }] }
}

function wantsTool(name: string, args = '{}') {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: args } }],
        },
      },
    ],
  }
}

const base = {
  question: 'who leads in touchdowns?',
  systemPrompt: 'You are Chimmy.',
  context: CTX,
  enabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('XAI_API_KEY', 'test-key')
  h.execute.mockResolvedValue('Leaders: 1. Josh Allen — 2')
})

afterEach(() => vi.unstubAllEnvs())

describe('canRunChimmyToolLoop', () => {
  it('needs the flag ON and a key present', () => {
    expect(canRunChimmyToolLoop(true)).toBe(true)
    expect(canRunChimmyToolLoop(false)).toBe(false)

    vi.stubEnv('XAI_API_KEY', '')
    vi.stubEnv('GROK_API_KEY', '')
    expect(canRunChimmyToolLoop(true)).toBe(false)
  })
})

describe('runChimmyToolLoop', () => {
  /* Off by default: the push path must keep running untouched. */
  it('does nothing at all when the flag is off', async () => {
    expect(await runChimmyToolLoop({ ...base, enabled: false })).toBeNull()
    expect(h.create).not.toHaveBeenCalled()
  })

  it('returns the answer without a tool when the model needs none', async () => {
    h.create.mockResolvedValue(answer('You have three games left.'))

    const out = await runChimmyToolLoop(base)

    expect(out).toMatchObject({ text: 'You have three games left.', toolsUsed: [], turns: 1 })
    expect(h.create).toHaveBeenCalledTimes(1)
  })

  it('offers the tools and lets the model choose', async () => {
    h.create.mockResolvedValue(answer('done'))

    await runChimmyToolLoop(base)

    const sent = h.create.mock.calls[0][0]
    expect(sent.tool_choice).toBe('auto')
    expect(sent.tools.map((t: any) => t.function.name)).toContain('get_stat_leaders')
  })

  it('runs a tool then answers from its result', async () => {
    h.create
      .mockResolvedValueOnce(wantsTool('get_stat_leaders', '{"stat":"touchdowns"}'))
      .mockResolvedValueOnce(answer('Josh Allen leads with 2.'))

    const out = await runChimmyToolLoop(base)

    expect(out).toMatchObject({ text: 'Josh Allen leads with 2.', toolsUsed: ['get_stat_leaders'], turns: 2 })
    expect(h.execute).toHaveBeenCalledWith('get_stat_leaders', { stat: 'touchdowns' }, CTX)
  })

  it('feeds the tool result back as a tool message', async () => {
    h.create
      .mockResolvedValueOnce(wantsTool('get_league_standings'))
      .mockResolvedValueOnce(answer('ok'))

    await runChimmyToolLoop(base)

    /*
     * Find it rather than taking the last element: the loop MUTATES one
     * messages array, and the mock captured a reference — by assertion time the
     * next turn's assistant message has already been pushed onto it.
     */
    const second = h.create.mock.calls[1][0].messages
    const toolMsg = second.find((m: any) => m.role === 'tool')
    expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: 'call_1' })
    expect(toolMsg.content).toContain('Josh Allen')

    /* The assistant turn that requested it must precede the reply. */
    expect(second.some((m: any) => m.tool_calls?.length)).toBe(true)
  })

  /*
   * The ceiling on cost. One charged message must not become an unbounded
   * number of paid provider calls.
   */
  it('never exceeds the turn ceiling', async () => {
    h.create.mockResolvedValue(wantsTool('get_league_standings'))

    const out = await runChimmyToolLoop(base)

    expect(out).toBeNull()
    expect(h.create.mock.calls.length).toBeLessThanOrEqual(3)
  })

  /*
   * If the model asks for another tool on the final turn there is no turn left
   * to read the answer — paying for one more call would buy nothing.
   */
  it('does not spend a final call it cannot use', async () => {
    h.create
      .mockResolvedValueOnce(wantsTool('get_league_standings'))
      .mockResolvedValueOnce(wantsTool('get_head_to_head'))
      .mockResolvedValueOnce(wantsTool('get_upcoming_games'))

    await runChimmyToolLoop(base)

    expect(h.create).toHaveBeenCalledTimes(3)
    /* The third response was a tool call, so no fourth execution was attempted. */
    expect(h.execute).toHaveBeenCalledTimes(2)
  })

  it('falls back rather than throwing when the provider fails', async () => {
    h.create.mockRejectedValue(new Error('rate limited'))
    await expect(runChimmyToolLoop(base)).resolves.toBeNull()
  })

  it('falls back when the model returns empty text', async () => {
    h.create.mockResolvedValue(answer('   '))
    expect(await runChimmyToolLoop(base)).toBeNull()
  })

  it('survives malformed tool arguments', async () => {
    h.create
      .mockResolvedValueOnce(wantsTool('get_stat_leaders', 'not json'))
      .mockResolvedValueOnce(answer('ok'))

    const out = await runChimmyToolLoop(base)

    expect(out?.text).toBe('ok')
    expect(h.execute).toHaveBeenCalledWith('get_stat_leaders', {}, CTX)
  })

  /* The league comes from the session; a model that can name one can name another's. */
  it('passes session context to the tool, not anything the model supplied', async () => {
    h.create
      .mockResolvedValueOnce(wantsTool('get_league_standings', '{"leagueId":"someone-elses"}'))
      .mockResolvedValueOnce(answer('ok'))

    await runChimmyToolLoop(base)

    expect(h.execute.mock.calls[0][2]).toEqual(CTX)
  })
})
