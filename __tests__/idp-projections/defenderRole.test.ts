import { describe, expect, it } from 'vitest'

import { deriveDefenderRole } from '@/lib/idp-projections/defenderRole'

import { tendencyForTeam } from '@/lib/idp-projections/teamTendencies'

/**
 * The role lines replace `idpRoleLabel`, which returned "Run Stopper" / "Edge Rusher" /
 * "Coverage" from the sum of the character codes of the player id, and rendered beside real
 * names. These pin what the replacement is allowed to claim.
 */

const line = (r: ReturnType<typeof deriveDefenderRole>, label: string) =>
  r.lines.find((l) => l.label === label)

describe('deriveDefenderRole — absence means zero here, and only here', () => {
  it('reads a missing sack key in a played game as a real zero', () => {
    /*
     * THE INVERSION. Everywhere else in this codebase a missing key means "unknown, do not
     * assume zero". `idp_sack` is written only when a sack happened — measured across 4,000 NFL
     * game rows it appears on 128 while `def_snp` appears on 1,077. Treating its absence as
     * unknown would refuse a sack rate for roughly seven of every eight defenders who played,
     * and report a data gap that does not exist.
     */
    const r = deriveDefenderRole([
      { def_snp: 60, idp_tkl: 5 },
      { def_snp: 55, idp_tkl: 4 },
    ])
    const sack = line(r, 'Sack rate')
    expect(sack?.value).toBe('none in 2 games')
    expect(sack?.basis).toContain('115 defensive snaps')
  })

  it('skips a game with no snap count entirely, rather than counting its blanks as zeros', () => {
    /*
     * The snap count is the discriminator. A game WITH one is a game we watched, so an absent
     * event in it is a real zero. A game without one is a game we have no record of — neither
     * its events nor its zeros can be trusted.
     */
    const r = deriveDefenderRole([
      { def_snp: 50, idp_sack: 1, idp_tkl: 6 },
      { idp_tkl: 99 }, // no snap count — must not inflate the tackle rate
    ])
    expect(r.games).toBe(1)
    expect(line(r, 'Tackle rate')?.basis).toContain('6 tackles over 50 snaps')
  })

  it('states a real sack rate as one-per-N snaps', () => {
    const r = deriveDefenderRole([
      { def_snp: 40, idp_sack: 1 },
      { def_snp: 36, idp_sack: 1 },
    ])
    expect(line(r, 'Sack rate')?.value).toBe('1 per 38 defensive snaps')
  })

  it('prefers the combined tackle column over the split ones, so a row carrying all three is not double-counted', () => {
    const r = deriveDefenderRole([{ def_snp: 60, idp_tkl: 6, idp_tkl_solo: 4, idp_tkl_ast: 2 }])
    expect(line(r, 'Tackle rate')?.basis).toContain('6 tackles')
  })

  it('falls back to the split columns when no combined total is on the row', () => {
    const r = deriveDefenderRole([{ def_snp: 60, idp_tkl_solo: 4, idp_tkl_ast: 2 }])
    expect(line(r, 'Tackle rate')?.basis).toContain('6 tackles')
  })
})

describe('deriveDefenderRole — what it refuses to claim', () => {
  it('never labels an archetype, because no snap-split column is ingested', () => {
    const r = deriveDefenderRole([{ def_snp: 60, idp_sack: 2, idp_tkl: 5 }])
    const labels = r.lines.map((l) => l.label)
    expect(labels).not.toContain('Archetype')
    for (const banned of ['Run Stopper', 'Edge Rusher', 'Coverage rate', 'Hybrid']) {
      expect(r.lines.some((l) => l.value === banned)).toBe(false)
    }
  })

  it('names the coverage gap instead of dropping the row', () => {
    // A dropped row reads as "nobody thought to look"; a named one reads as "we looked".
    const r = deriveDefenderRole([{ def_snp: 60, idp_tkl: 5 }])
    const cov = line(r, 'Coverage')
    expect(cov?.value).toBeNull()
    expect(cov?.basis).toContain('no targets-allowed column')
  })

  it('refuses everything when no game carries a snap count', () => {
    const r = deriveDefenderRole([{ idp_tkl: 8 }, {}, { rec: 3 }])
    expect(r.games).toBe(0)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].value).toBeNull()
    expect(r.lines[0].basis).toContain('refused rather than estimated')
  })

  it('survives an empty log list without inventing a shape', () => {
    expect(deriveDefenderRole([]).games).toBe(0)
  })
})

describe('teamTendencies — the suffix that carries the meaning', () => {
  it('reports the season, because coordinators change between years', () => {
    const t = tendencyForTeam('BUF')
    expect(t).not.toBeNull()
    expect(typeof t?.season).toBe('number')
    expect(t!.season).toBeGreaterThan(2000)
  })

  it('keeps the blitz rate as the defence’s OWN, not something it faced', () => {
    /*
     * In the source file the `Faced` suffix is explicit and load-bearing: `passRateFaced`,
     * `playsFaced` and `thirdDownRateFaced` describe what opposing offences did. `blitzRate`
     * has no suffix because it is what this defence itself does — the half a defender's own
     * sack chances rest on. The design this implements labelled it "BLITZ RATE FACED", which
     * inverts it.
     */
    const t = tendencyForTeam('BUF')
    expect(t?.blitzRate).not.toBeNull()
    expect(Object.keys(t ?? {})).not.toContain('blitzRateFaced')
  })

  it('exposes plays faced as a season total, not a per-game rate', () => {
    // The source carries no games-played column, so a per-game figure would require assuming a
    // 17-game season AND that the derivation excluded the playoffs.
    const t = tendencyForTeam('BUF')
    expect(t?.playsFacedSeason).toBeGreaterThan(500)
  })

  it('is case- and whitespace-insensitive, and null for a team it does not hold', () => {
    expect(tendencyForTeam(' buf ')?.teamId).toBe('BUF')
    expect(tendencyForTeam('ZZZ')).toBeNull()
    expect(tendencyForTeam(null)).toBeNull()
  })
})
