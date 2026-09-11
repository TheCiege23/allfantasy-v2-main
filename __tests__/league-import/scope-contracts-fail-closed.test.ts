/**
 * IMP-01 item 2 — provider scope contracts, validated FAIL-CLOSED.
 *
 * The first pass of this batch treated "absent on either side" as "no mismatch", which is
 * precisely the hole the scope encoding exists to close: a provider that answers without a
 * season cannot be shown to have honoured the requested season, so permitting the write lets
 * an unverifiable payload overwrite a verified one.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SCOPE_CONTRACT,
  findScopeMismatches,
  isDurableSyncError,
  PROVIDER_SCOPE_CONTRACTS,
  scopeContractFor,
  SyncScopeMismatchError,
} from '@/lib/league-import/sourceRef'

const REQUESTED = { sport: 'NBA', season: 2024 }

describe('the four required behaviours', () => {
  it('allows a matching scope', () => {
    expect(
      findScopeMismatches({
        provider: 'fleaflicker',
        requested: REQUESTED,
        returned: { sport: 'NBA', season: 2024 },
      }),
    ).toEqual([])
  })

  it('rejects a conflicting scope', () => {
    const problems = findScopeMismatches({
      provider: 'fleaflicker',
      requested: REQUESTED,
      returned: { sport: 'NFL', season: 2026 },
    })
    expect(problems.map((p) => p.kind)).toEqual(['mismatch', 'mismatch'])
    expect(problems.map((p) => p.field).sort()).toEqual(['season', 'sport'])
  })

  it('rejects a MISSING required dimension — the fail-closed case', () => {
    const problems = findScopeMismatches({
      provider: 'fleaflicker',
      requested: REQUESTED,
      returned: { sport: null, season: null },
    })
    expect(problems).toHaveLength(2)
    expect(problems.every((p) => p.kind === 'missing_required')).toBe(true)
    expect(problems.every((p) => p.returned === null)).toBe(true)
  })

  it('validates only the dimensions a provider actually defines', () => {
    /*
     * A Sleeper league id is globally unique and season-scoped by the provider, and its
     * adapter legitimately returns a null season. Requiring it would refuse healthy leagues
     * for a defect that cannot occur on that provider.
     */
    expect(
      findScopeMismatches({
        provider: 'sleeper',
        requested: { sport: 'NFL', season: 2026 },
        returned: { sport: 'NFL', season: null },
      }),
    ).toEqual([])
  })

  it('still rejects an opportunistic dimension that CONFLICTS', () => {
    /* Silence is tolerated for these providers; a contradiction never is. */
    const problems = findScopeMismatches({
      provider: 'sleeper',
      requested: { sport: 'NFL', season: 2026 },
      returned: { sport: 'NFL', season: 2019 },
    })
    expect(problems).toEqual([
      { field: 'season', kind: 'mismatch', requested: '2026', returned: '2019' },
    ])
  })
})

describe('the contracts themselves', () => {
  it('requires both dimensions for exactly the providers whose ids lose scope', () => {
    for (const p of ['espn', 'mfl', 'fleaflicker']) {
      expect(scopeContractFor(p).required).toEqual(['sport', 'season'])
    }
    for (const p of ['sleeper', 'yahoo', 'fantrax']) {
      expect(scopeContractFor(p).required).toEqual([])
      expect(scopeContractFor(p).opportunistic).toEqual(['sport', 'season'])
    }
  })

  it('fails CLOSED for an unrecognised provider', () => {
    /*
     * The permissive default is how the original hole shipped. A new provider nobody has
     * reasoned about gets the strict contract until someone writes it one.
     */
    expect(scopeContractFor('some-new-provider')).toBe(DEFAULT_SCOPE_CONTRACT)
    expect(DEFAULT_SCOPE_CONTRACT.required).toEqual(['sport', 'season'])
  })

  it('gives every contract a rationale, so the choice is reviewable', () => {
    for (const [, contract] of Object.entries(PROVIDER_SCOPE_CONTRACTS)) {
      expect(contract.rationale.length).toBeGreaterThan(20)
    }
  })

  it('REJECTS a required dimension the intended scope could not supply', () => {
    /*
     * 🛑 REVERSED IN BATCH A.1. This previously skipped, reasoning "nothing to verify against
     * is not a provider fault". For a provider whose parser DEFAULTS the dimension that is the
     * failure mode in disguise: the request goes out with a substituted season, the answer comes
     * back internally consistent, and nothing can tell whether it is the league we wanted.
     * `missing_target` names the real repair — supply the scope — rather than blaming the
     * provider for an answer we had no way to check.
     */
    expect(
      findScopeMismatches({
        provider: 'espn',
        requested: { sport: 'NFL', season: null },
        returned: { sport: 'NFL', season: 2026 },
      }),
    ).toEqual([{ field: 'season', kind: 'missing_target', requested: null, returned: '2026' }])
  })

  it('still skips an unknown target for an OPPORTUNISTIC dimension', () => {
    /* Sleeper's id pins the season, so an unknown target there is not a verification hole. */
    expect(
      findScopeMismatches({
        provider: 'sleeper',
        requested: { sport: 'NFL', season: null },
        returned: { sport: 'NFL', season: 2026 },
      }),
    ).toEqual([])
  })
})

describe('SyncScopeMismatchError is durable and safe to log', () => {
  it('is marked durable so the runner does not retry it', () => {
    const e = new SyncScopeMismatchError('espn', [
      { field: 'season', kind: 'mismatch', requested: '2023', returned: '2026' },
    ])
    expect(e.durable).toBe(true)
    expect(isDurableSyncError(e)).toBe(true)
    expect(isDurableSyncError(new Error('a throttle'))).toBe(false)
  })

  it('names requested and returned scope', () => {
    const e = new SyncScopeMismatchError('espn', [
      { field: 'season', kind: 'mismatch', requested: '2023', returned: '2026' },
    ])
    expect(e.message).toContain('2023')
    expect(e.message).toContain('2026')
  })

  it('says the provider reported NOTHING rather than printing a null', () => {
    const e = new SyncScopeMismatchError('fleaflicker', [
      { field: 'sport', kind: 'missing_required', requested: 'NBA', returned: null },
    ])
    expect(e.message).toMatch(/reported none/i)
    expect(e.message).not.toContain('null')
  })

  it('carries no credential or private league detail', () => {
    /*
     * This string reaches LeagueSyncState.lastError, SyncJobRun.errorMessage and operator
     * diagnostics. The repo has already paid once for a credential riding out on an error
     * path; the league is identified by the runKey the row is keyed on, not by this message.
     */
    const e = new SyncScopeMismatchError('yahoo', [
      { field: 'season', kind: 'mismatch', requested: '2024', returned: '2026' },
    ])
    expect(e.message).not.toMatch(/token|cookie|secret|password|swid|espn_s2|@/i)
  })
})
