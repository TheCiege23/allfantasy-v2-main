/**
 * Keeping the names an ESPN import already had.
 *
 * ESPN draft picks arrive carrying `playerName`; `DraftFact` has no column for it,
 * so it was dropped and Draft HQ re-resolved a bare ESPN id against an identity
 * table with zero ESPN rows — fourteen picks, fourteen "(not yet mapped)".
 *
 * The capture is at the call site. What is tested here is which rows may be
 * written, because the failure mode of getting it wrong is a fake name in a table
 * that several surfaces trust.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isPlaceholderPlayerName,
  normalizeSportKey,
  selectIngestableIdentities,
} from '@/lib/league-import/providerPlayerIdentities'

const BACKFILL = readFileSync(
  resolve(process.cwd(), 'lib/league-import/espn/EspnHistoricalBackfillService.ts'),
  'utf8',
).replace(/\r\n/g, '\n')

describe('⚠ a synthesised placeholder is not a name', () => {
  it('drops the parser fallback for the id it belongs to', () => {
    /*
     * The ESPN roster parser fills an unnamed player with `Player <id>`, and a
     * plain truthiness check passes it. Storing it would make Draft HQ print the
     * exact text it prints today for an UNMAPPED pick, but as a resolved name.
     */
    expect(
      selectIngestableIdentities([{ providerPlayerId: '2577417', displayName: 'Player 2577417' }]),
    ).toEqual([])
  })

  it('is precise: the same text is a real name against a different id', () => {
    // Only a placeholder when it names its own id. Blanket prefix matching would
    // discard a legitimate name that happens to start with the word.
    expect(isPlaceholderPlayerName('Player 2577417', '2577417')).toBe(true)
    expect(isPlaceholderPlayerName('Player 2577417', '9999999')).toBe(false)
    expect(isPlaceholderPlayerName('Player Smith', '2577417')).toBe(false)
  })

  it('keeps real names, including the negative ids ESPN uses for defences', () => {
    expect(
      selectIngestableIdentities([{ providerPlayerId: '-16012', displayName: 'Bears D/ST' }]),
    ).toEqual([{ providerPlayerId: '-16012', displayName: 'Bears D/ST' }])
  })
})

describe('⚠ what else is refused', () => {
  it('drops rows with no id and rows with no name', () => {
    expect(
      selectIngestableIdentities([
        { providerPlayerId: '', displayName: 'Nobody' },
        { providerPlayerId: '123', displayName: '   ' },
        { providerPlayerId: '456', displayName: null },
      ]),
    ).toEqual([])
  })

  it('dedupes on id, first occurrence winning, and preserves order', () => {
    expect(
      selectIngestableIdentities([
        { providerPlayerId: '1', displayName: 'First Name' },
        { providerPlayerId: '2', displayName: 'Second Name' },
        { providerPlayerId: '1', displayName: 'Contradicting Later' },
      ]),
    ).toEqual([
      { providerPlayerId: '1', displayName: 'First Name' },
      { providerPlayerId: '2', displayName: 'Second Name' },
    ])
  })

  it('trims rather than storing padded values', () => {
    expect(
      selectIngestableIdentities([{ providerPlayerId: ' 77 ', displayName: '  Puka Nacua  ' }]),
    ).toEqual([{ providerPlayerId: '77', displayName: 'Puka Nacua' }])
  })

  it('survives a malformed row instead of throwing mid-import', () => {
    // Capture is non-fatal by design; the selector must not be the thing that
    // breaks that promise.
    expect(selectIngestableIdentities([undefined as never, null as never])).toEqual([])
  })
})

describe('⚠ sport keys are uppercase in this table', () => {
  it('uppercases, because a lowercase key silently splits the data', () => {
    /*
     * Every existing row is uppercase — NFL 11,960 · NCAAF 39,671 · NCAAB 18,209.
     * A lowercase 'nfl' does not fail and does not look wrong; it just creates a
     * key nobody queries and stops the re-import dedupe from matching.
     */
    expect(normalizeSportKey('nfl')).toBe('NFL')
    expect(normalizeSportKey(' ncaaf ')).toBe('NCAAF')
  })

  it('defaults rather than writing an empty key', () => {
    expect(normalizeSportKey(undefined)).toBe('NFL')
    expect(normalizeSportKey('')).toBe('NFL')
  })
})

describe('⚠ the ESPN capture uses both rules', () => {
  it('filters through the selector rather than a truthiness check', () => {
    expect(BACKFILL).toContain('selectIngestableIdentities(')
    expect(BACKFILL).toContain('A TRUTHY NAME IS NOT A REAL NAME')
  })

  it('writes an uppercase sport key', () => {
    expect(BACKFILL).toContain('normalizeSportKey(args.payload.league.sport)')
  })

  it('stays outside the import transaction', () => {
    // A naming convenience must never fail a draft import that otherwise worked.
    const tx = BACKFILL.indexOf('await prisma.$transaction([')
    const capture = BACKFILL.indexOf('selectIngestableIdentities(')
    expect(tx).toBeGreaterThan(-1)
    expect(capture).toBeGreaterThan(tx)
    expect(BACKFILL).toContain('player identity capture non-fatal')
  })
})
