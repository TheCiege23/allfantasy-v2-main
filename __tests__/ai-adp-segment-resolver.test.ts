// @vitest-environment node
/**
 * Guards lib/ai-adp-engine/segment-resolver.ts, which decides WHICH BOARD a draft is
 * published under. A wrong key here is not coarse labelling — it files a superflex draft as
 * a 1QB board, and quarterbacks move a round or more between the two.
 *
 * Measured against all 115 production leagues, the fix changes 77 of them:
 *   38  default  -> sf         superflex stated in prose, previously dropped entirely
 *   26  default  -> ppr        PPR leagues that resolved to "unknown"
 *    8  standard -> ppr/half   `scoring_format_type` (a LEAGUE-TYPE field) hijacking scoring
 *    5  half-ppr -> sf         superflex pooled with a genuine 1QB half-PPR league
 */
import { describe, it, expect } from 'vitest'
import {
  resolveAiAdpFormatKeyFromSettings,
  resolveAiAdpLeagueType,
} from '@/lib/ai-adp-engine/segment-resolver'

const key = (s: Record<string, unknown>) => resolveAiAdpFormatKeyFromSettings(s)

describe('superflex detection', () => {
  it('reads superflex out of prose, which is the only place real leagues state it', () => {
    // No production league sets is_superflex/superflex/isSuperflex. They all write this.
    expect(key({ scoring: 'PPR Superflex' })).toBe('sf')
    expect(key({ scoring: 'PPR Superflex TEP' })).toBe('sf')
  })

  it('lets superflex outrank a scoring style stated elsewhere', () => {
    /*
     * The headline bug: identically-described leagues split across two segments, neither
     * named superflex, because scoring_format won and the prose was never read.
     */
    expect(key({ scoring: 'PPR Superflex TEP', scoring_format: 'half_ppr' })).toBe('sf')
    expect(key({ scoring: 'PPR Superflex', scoring_format: 'half_ppr' })).toBe('sf')
    // ...and the two now agree with the ones that carried no scoring_format.
    expect(key({ scoring: 'PPR Superflex TEP' })).toBe(key({ scoring: 'PPR Superflex TEP', scoring_format: 'half_ppr' }))
  })

  it('still honours the explicit booleans', () => {
    expect(key({ is_superflex: true })).toBe('sf')
    expect(key({ superflex: true })).toBe('sf')
    expect(key({ isSuperflex: true })).toBe('sf')
    expect(key({ scoring: { superflex: true } })).toBe('sf')
  })

  it('matches 2QB and a standalone sf token', () => {
    expect(key({ scoring: '2QB League' })).toBe('sf')
    expect(key({ format: 'SF' })).toBe('sf')
    expect(key({ scoring: 'PPR SF' })).toBe('sf')
  })

  it('does not fire on a word that merely contains those letters', () => {
    // 'sf' is word-bounded; 'Surfside' must not read as superflex.
    expect(key({ scoring: 'Surfside Dynasty' })).not.toBe('sf')
  })
})

describe('scoring_format_type is a league-type field, not a scoring field', () => {
  it('no longer overrides an explicit scoring format', () => {
    // 8 production leagues were published as non-PPR 'standard' on exactly this shape.
    expect(key({ scoring_format: 'ppr', scoring_format_type: 'standard' })).toBe('ppr')
    expect(key({ scoring_format: 'half_ppr', scoring_format_type: 'standard' })).toBe('half-ppr')
  })

  it('is ignored entirely rather than demoted — any value it holds is a league-type value', () => {
    expect(key({ scoring_format_type: 'standard' })).toBe('default')
    expect(key({ scoring_format_type: 'dynasty' })).toBe('default')
  })

  it('is still what leagueType reads for dynasty, which is why it cannot be repurposed', () => {
    expect(resolveAiAdpLeagueType({ settings: { scoring_format_type: 'dynasty' } })).toBe('dynasty')
    expect(resolveAiAdpLeagueType({ settings: { scoring_format_type: 'standard' } })).toBe('redraft')
  })
})

describe('prose may confirm a style but never invent one', () => {
  it('resolves a recognised style from prose', () => {
    expect(key({ scoring: 'PPR' })).toBe('ppr')
    expect(key({ scoring: 'PPR TEP' })).toBe('ppr')
    expect(key({ scoring: 'ppr' })).toBe('ppr')
    expect(key({ scoring: 'Half PPR' })).toBe('half-ppr')
  })

  it('refuses to turn an unrecognised league name into a segment key', () => {
    /*
     * A real league named 'devy' produced a `devy` formatKey before this guard. Prose is
     * free text: without the restriction, 'Best Ball Bonanza' becomes a board.
     */
    expect(key({ scoring: 'devy' })).toBe('default')
    expect(key({ scoring: 'Best Ball Bonanza' })).toBe('default')
    expect(key({ scoring: 'The League' })).toBe('default')
  })

  it('lets a precise field beat loose prose', () => {
    // One league stating the same thing twice, once exactly. The exact one wins.
    expect(key({ scoring: 'PPR', scoring_format: 'half_ppr' })).toBe('half-ppr')
  })
})

describe('structured fields keep their permissive tail', () => {
  it('passes through an unrecognised value in a field NAMED for the format', () => {
    // Unchanged long-standing behaviour: a format field carries a format claim.
    expect(key({ formatKey: 'guillotine' })).toBe('guillotine')
  })

  it('caps a runaway value rather than keying on unbounded text', () => {
    expect(key({ formatKey: 'x'.repeat(200) })).toHaveLength(32)
  })
})

describe('input hygiene', () => {
  it('skips non-string candidates instead of stringifying them into junk keys', () => {
    // String({}) is '[object Object]', which used to become a 32-char segment key.
    expect(key({ format: {} as unknown as string })).toBe('default')
    expect(key({ format: 42 as unknown as string })).toBe('default')
  })

  it('returns default for empty or absent settings', () => {
    expect(key({})).toBe('default')
    expect(resolveAiAdpFormatKeyFromSettings(null)).toBe('default')
    expect(resolveAiAdpFormatKeyFromSettings(undefined)).toBe('default')
    expect(key({ scoring: '   ' })).toBe('default')
  })

  it('still reads the numeric scoring object when one is present', () => {
    expect(key({ scoring: { ppr: 0.5 } })).toBe('half-ppr')
    expect(key({ scoring: { ppr: 0 } })).toBe('standard')
    expect(key({ scoring: { ppr: 1 } })).toBe('ppr')
  })
})
