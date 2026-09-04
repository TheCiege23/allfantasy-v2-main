/**
 * News → canonical player resolution at ingestion.
 *
 * The rule this suite exists to protect is the refusal: an ambiguous name is NEVER resolved.
 * Attaching an injury to the wrong player is worse than attaching it to nobody, because a wrong
 * attribution gets acted on while a missing one stays visible as a gap.
 *
 * The second rule is that unresolved is a legitimate outcome, not an error — the row is kept as
 * general news with its headline intact, and `playerId IS NOT NULL` is what marks a row as
 * attributed. Nothing here may turn an unattributable headline into a dropped one.
 */
import { describe, it, expect } from 'vitest'
import {
  buildNewsPlayerIndex,
  attributionRate,
  emptyNewsResolutionTally,
  tallyNewsResolution,
  NEWS_PLAYER_PLACEHOLDERS,
  type BuildNewsPlayerIndexDeps,
} from '../../lib/player-identity/resolveNewsPlayer'

function registry(rows: Array<{ id: string; canonicalName: string; currentTeam?: string | null }>): BuildNewsPlayerIndexDeps {
  return {
    loadRegistry: async () =>
      rows.map((r) => ({ id: r.id, canonicalName: r.canonicalName, currentTeam: r.currentTeam ?? null })),
  }
}

const NFL = registry([
  { id: 'p-swift', canonicalName: "D'Andre Swift", currentTeam: 'CHI' },
  { id: 'p-metcalf', canonicalName: 'DK Metcalf', currentTeam: 'SEA' },
  { id: 'p-okoye', canonicalName: 'C.J. Okoye', currentTeam: 'NYJ' },
  // A genuine collision: two real players, one name.
  { id: 'p-smith-a', canonicalName: 'Mike Williams', currentTeam: 'NYJ' },
  { id: 'p-smith-b', canonicalName: 'Mike Williams', currentTeam: 'PIT' },
])

describe('buildNewsPlayerIndex — resolution', () => {
  it('resolves an exact name and reports it as exact', async () => {
    const idx = await buildNewsPlayerIndex('NFL', NFL)
    expect(idx.resolve('DK Metcalf')).toEqual({ playerId: 'p-metcalf', matchType: 'exact' })
  })

  it('resolves through normalisation and says so — a curly apostrophe is the real production case', async () => {
    const idx = await buildNewsPlayerIndex('NFL', NFL)
    // U+2019 from the extractor vs U+0027 in the registry: measured as a real miss on production.
    const match = idx.resolve('D’Andre Swift')
    expect(match.playerId).toBe('p-swift')
    expect(match.matchType).toBe('normalized')
  })

  it('is case-insensitive without treating case as normalisation', async () => {
    const idx = await buildNewsPlayerIndex('NFL', NFL)
    expect(idx.resolve('dk metcalf').playerId).toBe('p-metcalf')
  })

  it('NEVER resolves an ambiguous name, even though picking one would raise the match rate', async () => {
    const idx = await buildNewsPlayerIndex('NFL', NFL)
    const match = idx.resolve('Mike Williams')
    expect(match.playerId).toBeNull()
    expect(match.matchType).toBe('ambiguous')
  })

  it('lets the news row own team break a collision, and only when it is decisive', async () => {
    const idx = await buildNewsPlayerIndex('NFL', NFL)
    expect(idx.resolve('Mike Williams', 'PIT')).toEqual({
      playerId: 'p-smith-b',
      matchType: 'team_disambiguated',
    })
    // A team that matches neither must NOT fall back to guessing one of them.
    expect(idx.resolve('Mike Williams', 'DEN').playerId).toBeNull()
  })

  it('treats every placeholder as general news, never as a lookup', async () => {
    const idx = await buildNewsPlayerIndex('NFL', NFL)
    for (const placeholder of NEWS_PLAYER_PLACEHOLDERS) {
      expect(idx.resolve(placeholder).matchType).toBe('unresolved')
    }
    expect(idx.resolve(null).matchType).toBe('unresolved')
    expect(idx.resolve('   ').matchType).toBe('unresolved')
  })

  it('leaves a non-player unresolved rather than forcing a match', async () => {
    const idx = await buildNewsPlayerIndex('NFL', NFL)
    // Real strings measured in the player column on production.
    for (const junk of ['Power Rankings', 'Dallas Cowboys', 'Eric Karabell', 'Various (e.g., Jaydon Blue)']) {
      expect(idx.resolve(junk)).toEqual({ playerId: null, matchType: 'unresolved' })
    }
  })
})

describe('buildNewsPlayerIndex — degradation', () => {
  it('an empty registry resolves nothing and does not throw', async () => {
    const idx = await buildNewsPlayerIndex('NFL', registry([]))
    expect(idx.size).toBe(0)
    expect(idx.resolve('DK Metcalf').matchType).toBe('unresolved')
  })

  it('a registry read failure degrades to unresolved rather than failing the ingestion run', async () => {
    const idx = await buildNewsPlayerIndex('NFL', {
      loadRegistry: async () => {
        throw new Error('registry unreachable')
      },
    })
    expect(idx.size).toBe(0)
    expect(idx.resolve('DK Metcalf').matchType).toBe('unresolved')
  })
})

describe('attribution telemetry', () => {
  it('reports null for an empty run — a rate over zero items is not 100%', () => {
    // The guard against a dead ingestion run reading as perfectly healthy.
    expect(attributionRate(emptyNewsResolutionTally())).toBeNull()
  })

  it('counts only real attributions toward the rate', () => {
    const t = emptyNewsResolutionTally()
    tallyNewsResolution(t, 'exact')
    tallyNewsResolution(t, 'normalized')
    tallyNewsResolution(t, 'team_disambiguated')
    tallyNewsResolution(t, 'ambiguous')
    tallyNewsResolution(t, 'unresolved')
    // 3 of 5 attributed — ambiguous is NOT an attribution, it is a refusal.
    expect(attributionRate(t)).toBeCloseTo(0.6, 5)
  })
})
