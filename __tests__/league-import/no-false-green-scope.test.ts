/**
 * IMP-02 item 4 — a canonical rebuild failure must not produce a completely successful sync.
 *
 * Preserving the previous canonical settings when a rebuild fails is right. Doing it SILENTLY
 * is the bug: the scope completed, `lastSuccessfulSyncAt` advanced, and Decision OS was told
 * this league's effective rules were current when they were the rules from whenever the last
 * successful rebuild happened.
 */

import { describe, expect, it } from 'vitest'

import { ScopeIncompleteError } from '@/lib/import-os/collector/scopeIncomplete'
import { isDurableSyncError } from '@/lib/league-import/sourceRef'
import { emptyApplyResult, mergeApplyResults } from '@/lib/import-os/collector/types'

describe('ScopeIncompleteError', () => {
  it('is durable, so the runner does not retry a deterministic failure', () => {
    const e = new ScopeIncompleteError('league_state', ['canonical settings rebuild failed: boom'])
    expect(e.durable).toBe(true)
    expect(isDurableSyncError(e)).toBe(true)
  })

  it('names the scope and every reason', () => {
    const e = new ScopeIncompleteError('teams_rosters', ['1 of 12 team rosters were not observed'])
    expect(e.scope).toBe('teams_rosters')
    expect(e.message).toContain('teams_rosters')
    expect(e.message).toContain('1 of 12')
  })

  it('states that last-good data was preserved and freshness did not advance', () => {
    /* The message is what an operator reads first; it has to answer "did I lose data?". */
    const e = new ScopeIncompleteError('league_state', ['rebuild failed'])
    expect(e.message).toMatch(/last-good data was preserved/i)
    expect(e.message).toMatch(/freshness was not advanced/i)
  })

  it('carries no credential or private league detail', () => {
    const e = new ScopeIncompleteError('league_state', ['canonical settings rebuild failed: TypeError'])
    expect(e.message).not.toMatch(/token|cookie|secret|password|swid|espn_s2|@/i)
  })
})

describe('incompleteReasons flow through the scope result', () => {
  it('starts empty, meaning genuinely complete', () => {
    expect(emptyApplyResult().incompleteReasons).toEqual([])
  })

  it('survives a merge across the league mirrors', () => {
    /*
     * `persistScope` applies each scope to EVERY canonical League row that mirrors the
     * connection, then aggregates. A reason raised on one mirror must not be lost when it is
     * merged with a clean one — that would be the false-green returning by the back door.
     */
    const clean = emptyApplyResult()
    const dirty = { ...emptyApplyResult(), incompleteReasons: ['canonical settings rebuild failed'] }

    expect(mergeApplyResults(clean, dirty).incompleteReasons).toEqual([
      'canonical settings rebuild failed',
    ])
    expect(mergeApplyResults(dirty, clean).incompleteReasons).toEqual([
      'canonical settings rebuild failed',
    ])
  })

  it('accumulates reasons from several mirrors rather than keeping one', () => {
    const a = { ...emptyApplyResult(), incompleteReasons: ['reason a'] }
    const b = { ...emptyApplyResult(), incompleteReasons: ['reason b'] }
    expect(mergeApplyResults(a, b).incompleteReasons).toEqual(['reason a', 'reason b'])
  })

  it('tolerates a result built before the field existed', () => {
    /* An older shape must merge as "no reasons", not throw — absent is not incomplete. */
    const legacy = { imported: 0, unchanged: 0, rejected: 0, removed: 0, notes: [] }
    expect(mergeApplyResults(legacy, emptyApplyResult()).incompleteReasons).toEqual([])
  })
})
