// @vitest-environment node
/**
 * lib/workers/injury-importer.ts — the player-id rule.
 *
 * `playerId` sits inside the upsert's unique key (sport, playerId, reportDate,
 * status), and the upsert's `update` overwrites `playerName`. So a falsy id is
 * not a cosmetic problem: every unresolved player sharing a sport, date and
 * status lands on ONE row, each write erasing the last player's identity.
 * Production held 1,047 such rows on 2026-08-27 — an unknown, larger number of
 * players compressed into 1,047 slots.
 *
 * These tests pin the rule that stops that: no resolvable id, no row.
 */
import { describe, it, expect, vi } from 'vitest'

// The importer imports prisma at module scope, which throws without DATABASE_URL.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { resolvePlayerId } from '@/lib/workers/injury-importer'

describe('resolvePlayerId', () => {
  it('prefers an explicit playerId', () => {
    expect(resolvePlayerId({ playerId: '4034', externalId: '9999' })).toBe('4034')
  })

  it('falls back to externalId', () => {
    expect(resolvePlayerId({ externalId: 'sleeper:1234' })).toBe('sleeper:1234')
  })

  it('accepts a numeric id, which providers send unquoted', () => {
    expect(resolvePlayerId({ playerId: 4034 })).toBe('4034')
  })

  describe('refuses anything that would land as a falsy key', () => {
    // Each of these previously became '' via `String(x ?? y ?? '')` and went
    // into the unique key.
    const rejected: Array<[string, unknown]> = [
      ['missing', undefined],
      ['null', null],
      ['empty string', ''],
      ['whitespace only', '   '],
      ['NaN', Number.NaN],
    ]
    for (const [label, value] of rejected) {
      it(`rejects ${label}`, () => {
        expect(resolvePlayerId({ playerId: value, externalId: value })).toBeNull()
      })
    }
  })

  it('does not treat "0" as missing', () => {
    // A real id that is falsy as a number must still count — the old `??` chain
    // got this right and a `||` rewrite would not.
    expect(resolvePlayerId({ playerId: '0' })).toBe('0')
    expect(resolvePlayerId({ playerId: 0 })).toBe('0')
  })

  it('trims, so a padded id does not become a distinct key', () => {
    expect(resolvePlayerId({ playerId: '  4034  ' })).toBe('4034')
  })

  describe('placeholder sentinels are not ids', () => {
    // The column carries a SECOND placeholder shape besides '': 'unk:...' with
    // playerName 'Unknown', 56 rows in production. An earlier draft of this
    // helper accepted any non-empty string, closing the 991 blanks and letting
    // all 56 of these through.
    for (const sentinel of ['unk:', 'unk:12345', 'UNK:abc', 'unk_1', 'unk-1']) {
      it(`rejects ${JSON.stringify(sentinel)}`, () => {
        expect(resolvePlayerId({ playerId: sentinel })).toBeNull()
      })
    }

    it('falls through to a real externalId when playerId is a sentinel', () => {
      expect(resolvePlayerId({ playerId: 'unk:9', externalId: '4034' })).toBe('4034')
    })

    it('does not reject a real id that merely begins with those letters', () => {
      // The boundary is the separator, which is why the pattern requires one.
      expect(resolvePlayerId({ playerId: 'unkart99' })).toBe('unkart99')
    })
  })
})
