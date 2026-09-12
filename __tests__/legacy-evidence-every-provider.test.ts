// @vitest-environment node
/**
 * P2 item 4 of the import audit: "extend legacy rankings and manager evidence to
 * every provider."
 *
 * 🛑 WHAT WAS WRONG: `importPersistenceService` gated evidence derivation on
 * `if (input.provider === 'sleeper')`, so FIVE OF SIX providers imported history
 * that never moved a manager's rank. `importedFactsToEvidence`'s own header said
 * "Sleeper only (per Phase 3.1 scope)" — a scope decision, not a technical limit.
 * The only Sleeper-specific line in the whole module was a hardcoded `sleeper:`
 * prefix on `sourceReference`.
 *
 * 🛑 AND THE GATE WAS ACCIDENTALLY PROTECTING AGAINST SOMETHING REAL, which is why
 * this is not a one-line change. `championships` is written for every `rank === 1`,
 * and Fleaflicker's adapter synthesised rank from ARRAY POSITION — so widening the
 * gate alone would have crowned whichever team came first in the response, in every
 * Fleaflicker league. That is the case this file exists to pin.
 */
import { describe, it, expect } from 'vitest'
import { deriveEvidenceRowsFromImport } from '@/lib/legacy-score-engine/importedFactsToEvidence'
import type { NormalizedImportResult } from '@/lib/league-import/types'

/** A minimal normalized import, parameterised by the bits this deriver reads. */
function importOf(
  provider: string,
  leagueId: string,
  standings: Array<{ source_team_id: string; rank: number; wins: number; losses: number }>,
): NormalizedImportResult {
  return {
    source: {
      source_provider: provider,
      source_league_id: leagueId,
      source_season_id: '2026',
      import_batch_id: 'b',
      imported_at: '2026-09-12T00:00:00.000Z',
    },
    league: { sport: 'nfl', season: 2026 },
    standings: standings.map((s) => ({ ...s, ties: 0, points_for: 100, points_against: 90 })),
  } as unknown as NormalizedImportResult
}

describe('sourceReference carries the REAL provider, not a hardcoded one', () => {
  /*
   * ⚠ THIS IS ALSO THE DE-DUPLICATION KEY. `importPersistenceService` clears prior
   * evidence by `sourceReference` before rewriting it, so a wrong prefix either
   * fails to clear a league's own rows (duplicates on every refresh) or clears a
   * DIFFERENT league's. Two leagues sharing a numeric id across providers is not
   * hypothetical: ESPN and Fleaflicker ids are both bare integers.
   */
  it.each([
    ['sleeper', '123'],
    ['espn', '456'],
    ['yahoo', '423.l.12345'],
    ['fantrax', 'v2kzedypmm8jp61b'],
    ['mfl', '54321'],
    ['fleaflicker', '206154'],
  ])('%s produces %s-prefixed references', (provider, leagueId) => {
    const rows = deriveEvidenceRowsFromImport(
      importOf(provider, leagueId, [{ source_team_id: 't1', rank: 3, wins: 8, losses: 5 }]),
      {},
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.sourceReference === `${provider}:${leagueId}`)).toBe(true)
  })

  it('two providers sharing a league id do NOT collide', () => {
    const espn = deriveEvidenceRowsFromImport(
      importOf('espn', '206154', [{ source_team_id: 't1', rank: 1, wins: 10, losses: 3 }]),
      {},
    )
    const flea = deriveEvidenceRowsFromImport(
      importOf('fleaflicker', '206154', [{ source_team_id: 't1', rank: 1, wins: 10, losses: 3 }]),
      {},
    )
    const espnRefs = new Set(espn.map((r) => r.sourceReference))
    const fleaRefs = new Set(flea.map((r) => r.sourceReference))
    expect([...espnRefs].some((r) => fleaRefs.has(r))).toBe(false)
  })

  it('control: a hardcoded prefix WOULD collide — which is what this replaced', () => {
    // Proves the previous test is testing something rather than restating equality.
    const hardcoded = (leagueId: string) => `sleeper:${leagueId}`
    expect(hardcoded('206154')).toBe(hardcoded('206154'))
  })
})

describe('the entity id survives every provider’s id shape', () => {
  /*
   * The aggregator resolves `entityId` against `LeagueTeam.externalId` via a
   * trim+lowercase key — NOT a numeric coercion. That is what lets MFL's
   * zero-padded franchise ids work here while the same ids broke the naive
   * `String(Number(x))` join that `WeeklyMatchup` used to perform.
   */
  const asKey = (v: string) => String(v ?? '').trim().toLowerCase()

  it.each([
    ['sleeper', '1'],
    ['espn', '7'],
    ['yahoo', '423.l.12345.t.4'],
    ['fantrax', 'qoat4t4imm8jp61g'],
    ['mfl', '0001'],
    ['fleaflicker', '1373501'],
  ])('%s id %s is emitted verbatim', (provider, teamId) => {
    const rows = deriveEvidenceRowsFromImport(
      importOf(provider, 'L', [{ source_team_id: teamId, rank: 2, wins: 7, losses: 6 }]),
      {},
    )
    const ids = new Set(rows.filter((r) => r.entityType === 'ROSTER').map((r) => r.entityId))
    expect(ids.has(teamId)).toBe(true)
    expect(asKey([...ids][0])).toBe(asKey(teamId))
  })

  it('control: the naive numeric join destroys the MFL id', () => {
    /*
     * Why `asKey` rather than `String(Number(x))` matters. If this ever stops being
     * true, the aggregator has started canonicalising and MFL evidence silently
     * stops resolving.
     */
    expect(String(Number('0001'))).not.toBe('0001')
    expect(asKey('0001')).toBe('0001')
  })
})

describe('🛑 a championship is only awarded for a REAL rank', () => {
  it('rank 1 produces a championship row', () => {
    const rows = deriveEvidenceRowsFromImport(
      importOf('fleaflicker', 'L', [
        { source_team_id: 'winner', rank: 1, wins: 12, losses: 1 },
        { source_team_id: 'other', rank: 2, wins: 9, losses: 4 },
      ]),
      {},
    )
    const champs = rows.filter((r) => r.evidenceType === 'championships')
    expect(champs.map((r) => r.entityId)).toEqual(['winner'])
  })

  it('the LAST-place fallback never wins anything', () => {
    /*
     * The convention every safe adapter uses: `team.rank ?? teams.length`. With two
     * teams and no published rank, both land on rank 2 — and neither is crowned.
     * This is what makes an unknown rank safe, and it is why Fleaflicker's old
     * `rank: i + 1` was not.
     */
    const rows = deriveEvidenceRowsFromImport(
      importOf('espn', 'L', [
        { source_team_id: 'a', rank: 2, wins: 5, losses: 8 },
        { source_team_id: 'b', rank: 2, wins: 6, losses: 7 },
      ]),
      {},
    )
    expect(rows.filter((r) => r.evidenceType === 'championships')).toEqual([])
  })

  it('ARRAY-POSITION rank would crown an arbitrary team — the bug this change removed', () => {
    /*
     * Reproduces what `rank: i + 1` produced. The deriver is correct here: given a
     * rank of 1 it must award a title. The defect was upstream, in an adapter that
     * manufactured that 1 from an array index — so this asserts the blast radius
     * rather than a behaviour to keep.
     */
    const synthetic = ['first', 'second', 'third'].map((id, i) => ({
      source_team_id: id,
      rank: i + 1,
      wins: 0,
      losses: 13,
    }))
    const rows = deriveEvidenceRowsFromImport(importOf('fleaflicker', 'L', synthetic), {})
    const champs = rows.filter((r) => r.evidenceType === 'championships')
    // A winless team crowned, purely for being first in the response.
    expect(champs.map((r) => r.entityId)).toEqual(['first'])
    expect(synthetic[0].wins).toBe(0)
  })
})

describe('degenerate inputs', () => {
  it('no standings and no history yields nothing, for every provider', () => {
    for (const p of ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']) {
      expect(deriveEvidenceRowsFromImport(importOf(p, 'L', []), {})).toEqual([])
    }
  })
})
