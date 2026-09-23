/**
 * Giving an ADP-seeded pool row the provider id it should have had.
 *
 * An ADP row carries a name, a position and a team — no id. The draft pool resolves one by
 * matching that row against the DB player pool; when the match misses, `normalizeDraftPlayer`
 * mints `name:<Name>:<POS>:<TEAM>` and the DRAFT WRITES THAT onto the roster permanently. Such a
 * player can never be scored, because no provider feed uses those ids.
 *
 * Measured on production 2026-09-22: 23 of 90 starters in the one native league that has played
 * carried synthetic ids — including `name:Aaron Jones Sr.:RB:MIN`, whose pool row holds
 * `sleeperId 4199`. The match was missing on spelling alone.
 *
 * The risk in fixing it is the opposite error: attaching one man's id to another. So the last,
 * suffix-collapsing tier must refuse whenever a base name is claimed by more than one identity
 * (Marvin Harrison Jr. / Sr.), and these tests pin both directions.
 */
import { describe, expect, it } from 'vitest'

import {
  canonicalName,
  canonicalPosition,
  strictIdentityKey,
  strictIdentityKeyWithTeam,
  suffixlessCanonicalName,
} from '@/lib/draft-room/player-canonical-identity'

type PoolRow = { full_name: string; position: string; team_abbreviation: string | null; external_source_id: string | null }

/**
 * The resolver's matching tiers, in the same order and with the same guard. Kept in step with
 * `getResolvedDraftPoolForLeague` — the point under test is the KEY LADDER, which is pure.
 */
function buildMatcher(poolRows: PoolRow[]) {
  const byStrict = new Map<string, PoolRow>()
  const byLoose = new Map<string, PoolRow>()
  const byCanonical = new Map<string, PoolRow>()
  const byCanonicalNamePos = new Map<string, PoolRow>()
  const bySuffixless = new Map<string, PoolRow>()
  const suffixlessIdentities = new Map<string, Set<string>>()

  const raw = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase()

  for (const row of poolRows) {
    const strict = `${raw(row.full_name)}|${raw(row.position)}|${raw(row.team_abbreviation)}`
    const loose = `${raw(row.full_name)}|${raw(row.position)}`
    if (!byStrict.has(strict)) byStrict.set(strict, row)
    if (!byLoose.has(loose)) byLoose.set(loose, row)
    if (!byCanonical.has(strictIdentityKeyWithTeam(row.full_name, row.position, row.team_abbreviation))) {
      byCanonical.set(strictIdentityKeyWithTeam(row.full_name, row.position, row.team_abbreviation), row)
    }
    if (!byCanonicalNamePos.has(strictIdentityKey(row.full_name, row.position))) {
      byCanonicalNamePos.set(strictIdentityKey(row.full_name, row.position), row)
    }
    const base = suffixlessCanonicalName(row.full_name)
    if (base) {
      const key = `${base}|${canonicalPosition(row.position)}`
      if (!bySuffixless.has(key)) bySuffixless.set(key, row)
      const ids = suffixlessIdentities.get(key) ?? new Set<string>()
      ids.add(strictIdentityKey(row.full_name, row.position))
      suffixlessIdentities.set(key, ids)
    }
  }

  return function match(
    name: string,
    position: string,
    team: string | null,
    opts: { inJrAliasConflict?: boolean } = {},
  ): PoolRow | undefined {
    const strict = `${raw(name)}|${raw(position)}|${raw(team)}`
    const loose = `${raw(name)}|${raw(position)}`
    const suffixlessKey = `${suffixlessCanonicalName(name)}|${canonicalPosition(position)}`
    const unambiguous =
      !opts.inJrAliasConflict && (suffixlessIdentities.get(suffixlessKey)?.size ?? 0) === 1
    return (
      byStrict.get(strict) ??
      byLoose.get(loose) ??
      byCanonical.get(strictIdentityKeyWithTeam(name, position, team)) ??
      byCanonicalNamePos.get(strictIdentityKey(name, position)) ??
      (unambiguous ? bySuffixless.get(suffixlessKey) : undefined)
    )
  }
}

describe('suffixlessCanonicalName', () => {
  it('strips generational suffixes, and only those', () => {
    expect(suffixlessCanonicalName('Aaron Jones Sr.')).toBe('aaron jones')
    expect(suffixlessCanonicalName('Marvin Harrison Jr.')).toBe('marvin harrison')
    expect(suffixlessCanonicalName('Robert Griffin III')).toBe('robert griffin')
    expect(suffixlessCanonicalName('Ja’Marr Chase')).toBe('jamarr chase')
  })

  it('never strips a name down to nothing', () => {
    // A player known only as a suffix-like token keeps it rather than becoming an empty key,
    // which would match every other unnamed row.
    expect(suffixlessCanonicalName('Sr')).toBe('sr')
    expect(suffixlessCanonicalName('')).toBe('')
  })

  it('leaves the suffix-preserving canonical name alone', () => {
    // The guarantee the rest of the identity system relies on.
    expect(canonicalName('Marvin Harrison Jr.')).toBe('marvin harrison jr')
    expect(canonicalName('Marvin Harrison')).toBe('marvin harrison')
  })
})

describe('draft pool provider-id matching', () => {
  const pool: PoolRow[] = [
    { full_name: 'Aaron Jones', position: 'RB', team_abbreviation: 'MIN', external_source_id: '4199' },
    { full_name: "Ja'Marr Chase", position: 'WR', team_abbreviation: 'CIN', external_source_id: '7564' },
    { full_name: 'A.J. Brown', position: 'WR', team_abbreviation: 'PHI', external_source_id: '5846' },
  ]

  it('matches the production case that minted a synthetic id', () => {
    const match = buildMatcher(pool)
    // The ADP seed spells it with the suffix; the pool row does not.
    expect(match('Aaron Jones Sr.', 'RB', 'MIN')?.external_source_id).toBe('4199')
  })

  it('matches across punctuation and initials without needing the suffix tier', () => {
    const match = buildMatcher(pool)
    expect(match('JaMarr Chase', 'WR', 'CIN')?.external_source_id).toBe('7564')
    expect(match('AJ Brown', 'WR', 'PHI')?.external_source_id).toBe('5846')
  })

  it('still matches when the feed carries a stale team', () => {
    const match = buildMatcher(pool)
    expect(match('Aaron Jones Sr.', 'RB', 'GB')?.external_source_id).toBe('4199')
  })

  it('REFUSES to collapse a father and son', () => {
    const fatherSon = buildMatcher([
      { full_name: 'Marvin Harrison', position: 'WR', team_abbreviation: 'IND', external_source_id: '111' },
      { full_name: 'Marvin Harrison Jr.', position: 'WR', team_abbreviation: 'ARI', external_source_id: '222' },
    ])
    // Exact spellings still resolve to the right man…
    expect(fatherSon('Marvin Harrison Jr.', 'WR', 'ARI')?.external_source_id).toBe('222')
    expect(fatherSon('Marvin Harrison', 'WR', 'IND')?.external_source_id).toBe('111')
    // …but a spelling that matches neither exactly gets NO id rather than a guessed one.
    expect(fatherSon('Marvin Harrison Sr.', 'WR', null)).toBeUndefined()
  })

  it('disables exactly one tier when the caller reports a Jr/Sr conflict', () => {
    const match = buildMatcher(pool)
    // An exact spelling still resolves — the flag does not disturb the earlier tiers.
    expect(match('Aaron Jones', 'RB', 'MIN', { inJrAliasConflict: true })?.external_source_id).toBe('4199')
    // The suffixed spelling is reachable ONLY through the suffix tier, so the flag refuses it.
    // Same input without the flag matches (asserted above), which is what makes this a real gate.
    expect(match('Aaron Jones Sr.', 'RB', 'MIN', { inJrAliasConflict: true })).toBeUndefined()
  })

  it('does not invent a match for someone who is not in the pool', () => {
    const match = buildMatcher(pool)
    expect(match('Nobody Here', 'RB', 'KC')).toBeUndefined()
  })
})
