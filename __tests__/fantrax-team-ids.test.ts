import { describe, expect, it } from 'vitest'

import {
  assignFantraxTeamIds,
  fantraxTeamHash,
  isLegacyFantraxTeamId,
  normalizeFantraxTeamName,
} from '@/lib/league-import/fantrax/fantraxTeamIds'

/**
 * 🛑 THE CONTRACT THIS FILE PROTECTS: `WeeklyMatchup.rosterId` IS AN `Int`, AND
 * EVERY READER MAPS IT BACK WITH `Number(LeagueTeam.externalId)`.
 *
 * Fantrax team ids used to be minted as `fantrax-team:<slug>`, so `Number()` was
 * `NaN` and `lib/core-app/weekBoard.ts` dropped every Fantrax team out of its
 * roster-name and my-team lookups without erroring — a scoreboard that cannot
 * name an opponent. Production evidence:
 * `fantrax-team:ciege82=fantrax-user:Ciege82[claimed]`.
 */
describe('the numeric roster id Fantrax never had', () => {
  it('produces something Number() can actually read', () => {
    const ids = assignFantraxTeamIds([
      { sourceTeamId: 'qoat4t4imm8jp61g', teamName: 'Ciege82' },
      { sourceTeamId: 'j0m5j9u6mm8jp61f', teamName: 'king gustov' },
    ])
    for (const id of ids.values()) {
      expect(Number.isInteger(id)).toBe(true)
      expect(Number.isNaN(Number(String(id)))).toBe(false)
    }
  })

  /** Postgres `int4` tops out at 2147483647, and 0 is not a usable roster id. */
  it('stays inside int4 and never emits zero', () => {
    for (const key of ['a', 'qoat4t4imm8jp61g', '', 'a very long fantrax team identifier x9']) {
      const n = fantraxTeamHash(key)
      expect(n).toBeGreaterThan(0)
      expect(n).toBeLessThan(2_147_483_647)
    }
  })

  it('is a pure function of the key — same input, same id, every run', () => {
    expect(fantraxTeamHash('qoat4t4imm8jp61g')).toBe(fantraxTeamHash('qoat4t4imm8jp61g'))
  })
})

/**
 * ⚠ HASHED, NOT INDEXED. The obvious mapping — sort the teams and number them
 * 1..N — is stable only while the team SET is. These two tests are the reason
 * that design was rejected: under indexing, both would fail, and the failure is
 * silent re-attribution of historical weeks rather than an error.
 */
describe('an id survives the league changing around it', () => {
  const CIEGE = { sourceTeamId: 'qoat4t4imm8jp61g', teamName: 'Ciege82' }
  const GUSTOV = { sourceTeamId: 'j0m5j9u6mm8jp61f', teamName: 'king gustov' }
  const LOGAN = { sourceTeamId: '08i745zzmm8jp61f', teamName: 'loganhall' }

  it('keeps its id when another team joins the league', () => {
    const before = assignFantraxTeamIds([CIEGE, GUSTOV])
    const after = assignFantraxTeamIds([CIEGE, GUSTOV, LOGAN])
    expect(after.get('ciege82')).toBe(before.get('ciege82'))
    expect(after.get('king gustov')).toBe(before.get('king gustov'))
  })

  it('keeps its id when the team is renamed', () => {
    const before = assignFantraxTeamIds([CIEGE, GUSTOV])
    const after = assignFantraxTeamIds([
      { sourceTeamId: 'qoat4t4imm8jp61g', teamName: 'Ciege the Second' },
      GUSTOV,
    ])
    expect(after.get('ciege the second')).toBe(before.get('ciege82'))
  })

  it('does not depend on the order the teams arrive in', () => {
    const a = assignFantraxTeamIds([CIEGE, GUSTOV, LOGAN])
    const b = assignFantraxTeamIds([LOGAN, CIEGE, GUSTOV])
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b))
  })
})

describe('two teams never share a roster id', () => {
  /**
   * ⚠ A SHARED ROSTER ID READS AS ONE TEAM PLAYING ITSELF. A 32-bit collision
   * inside a twelve-team league is vanishingly unlikely, but "unlikely" across
   * every league forever is not "never" — so it is resolved rather than ignored,
   * and resolved deterministically so two runs cannot swap two teams.
   */
  it('assigns distinct ids across a full twelve-team league', () => {
    const teams = Array.from({ length: 12 }, (_, i) => ({
      sourceTeamId: `team${i}mm8jp61f`,
      teamName: `Team ${i}`,
    }))
    const ids = assignFantraxTeamIds(teams)
    expect(ids.size).toBe(12)
    expect(new Set(ids.values()).size).toBe(12)
  })

  it('collapses two spellings of one team rather than issuing two ids', () => {
    const ids = assignFantraxTeamIds([
      { sourceTeamId: 'qoat4t4imm8jp61g', teamName: 'Ciege82' },
      { sourceTeamId: 'qoat4t4imm8jp61g', teamName: '  ciege82  ' },
    ])
    expect(ids.size).toBe(1)
  })
})

/**
 * ⚠ THE NAME IS THE FALLBACK, NOT THE KEY. A CSV-era snapshot carries no Fantrax
 * team ids at all, and the backfill has none either — `LeagueTeam` never stored
 * one. Those must still get a stable id.
 */
describe('snapshots that never had a Fantrax id', () => {
  it('falls back to the name and still yields a usable id', () => {
    const ids = assignFantraxTeamIds([
      { sourceTeamId: null, teamName: 'Ciege82' },
      { sourceTeamId: null, teamName: 'king gustov' },
    ])
    expect(ids.size).toBe(2)
    for (const id of ids.values()) expect(Number.isInteger(id)).toBe(true)
  })

  /**
   * The importer and the backfill sit either side of the snapshot and MUST agree
   * byte for byte. Both key on the name when no source id is present, so the
   * same league keyed either way lands on the same numbers.
   */
  it('agrees with itself whether the caller passes null or omits the field', () => {
    const a = assignFantraxTeamIds([{ sourceTeamId: null, teamName: 'Ciege82' }])
    const b = assignFantraxTeamIds([{ teamName: 'Ciege82' }])
    expect(Object.fromEntries(a)).toEqual(Object.fromEntries(b))
  })

  it('drops a team with no name to key on rather than inventing one', () => {
    const ids = assignFantraxTeamIds([{ sourceTeamId: null, teamName: '   ' }])
    expect(ids.size).toBe(0)
  })
})

describe('recognising what still needs migrating', () => {
  it('matches the legacy shape and nothing else', () => {
    expect(isLegacyFantraxTeamId('fantrax-team:ciege82')).toBe(true)
    expect(isLegacyFantraxTeamId('fantrax-team:unknown')).toBe(true)
    /* ⚠ A NUMERIC ID HAS ALREADY BEEN MIGRATED. Matching it would renumber a
       second time on the next run. */
    expect(isLegacyFantraxTeamId('1483920211')).toBe(false)
    expect(isLegacyFantraxTeamId('')).toBe(false)
  })
})

describe('the normalizer both sides share', () => {
  it('collapses case and whitespace the same way the importer does', () => {
    expect(normalizeFantraxTeamName('  King   Gustov ')).toBe('king gustov')
  })
})
