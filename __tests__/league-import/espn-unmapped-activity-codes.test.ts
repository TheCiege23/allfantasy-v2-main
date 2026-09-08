import { describe, expect, it, vi, afterEach } from 'vitest'

import { parseEspnTransactions } from '@/lib/league-import/espn/EspnLeagueFetchService'

/*
 * 🛑 ESPN LEAGUES HOLD ZERO TRADES AND WE COULD NOT SAY WHY. Measured on
 * production 2026-09-08: ESPN contributes 39 transaction rows, all waiver/add/
 * drop, and not one of type `trade` -- against Sleeper's 18,657.
 * `ESPN_ACTIVITY_TYPE_MAP` carries exactly ONE trade code (244), and anything
 * absent from it was discarded by a bare `continue`: no counter, no log, no error.
 *
 * That made two states indistinguishable -- "these leagues had no trades" and
 * "ESPN sent trades under a code we do not map". These tests pin the tally that
 * separates them.
 *
 * ⚠ NO NEW CODES ARE GUESSED HERE, DELIBERATELY. There is no ESPN contract in
 * `contracts/`, so a code added from memory would silently MISLABEL real
 * transactions -- worse than dropping them. The tally is how the real codes get
 * discovered before the map is widened.
 */

const topic = (messages: Array<Record<string, unknown>>) => ({
  topics: [{ id: 't1', date: 1757000000000, messages }],
})

const trade244 = { id: 'm1', messageTypeId: 244, targetId: '3139477', from: '1', to: '2' }

afterEach(() => vi.restoreAllMocks())

describe('ESPN activity: unmapped messageTypeId', () => {
  it('still parses a mapped trade code into a trade transaction', () => {
    const out = parseEspnTransactions(topic([trade244]), new Map())
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('trade')
    expect(out[0].messageTypeId).toBe(244)
  })

  it('drops an unmapped code but REPORTS it rather than swallowing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = parseEspnTransactions(
      topic([{ id: 'm2', messageTypeId: 9999, targetId: '1', from: '1', to: '2' }]),
      new Map(),
    )
    expect(out).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('unmapped messageTypeId')
    expect(line).toContain('9999x1')
  })

  /* The count is the point: one occurrence and forty look identical without it. */
  it('counts repeats and orders by frequency', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseEspnTransactions(
      topic([
        { id: 'a', messageTypeId: 777, targetId: '1', to: '2' },
        { id: 'b', messageTypeId: 888, targetId: '1', to: '2' },
        { id: 'c', messageTypeId: 888, targetId: '1', to: '2' },
        { id: 'd', messageTypeId: 888, targetId: '1', to: '2' },
      ]),
      new Map(),
    )
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('dropped 4 message(s)')
    expect(line.indexOf('888x3')).toBeLessThan(line.indexOf('777x1'))
  })

  /* A dropped message must not take the rest of the feed with it. */
  it('keeps mapped messages alongside unmapped ones', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = parseEspnTransactions(
      topic([{ id: 'x', messageTypeId: 4242, targetId: '9', to: '2' }, trade244]),
      new Map(),
    )
    expect(out.map((t) => t.type)).toEqual(['trade'])
  })

  it('says nothing when every code is mapped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseEspnTransactions(topic([trade244]), new Map())
    expect(warn).not.toHaveBeenCalled()
  })

  /* Codes and counts only -- these logs are public and must carry no identifiers. */
  it('logs no player, team or league identifiers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    parseEspnTransactions(
      topic([{ id: 'opaque-msg-id', messageTypeId: 5150, targetId: '3139477', from: '77', to: '88' }]),
      new Map(),
    )
    const line = String(warn.mock.calls[0][0])
    expect(line).not.toContain('3139477')
    expect(line).not.toContain('opaque-msg-id')
  })
})
