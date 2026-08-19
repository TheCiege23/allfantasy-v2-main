import { describe, expect, it } from 'vitest'

import { scoreStatLine } from '@/lib/sports-data/sleeperMarketService'

/** Real Jonathan Greenard (DE) week-1 projection row from Sleeper's projections feed. */
const DEF_PROJECTION = {
  adp_dd_ppr: 999,
  gp: 1,
  idp_ff: 0.12,
  idp_pass_def: 0.18,
  idp_sack: 0.66,
  idp_sack_yd: 4.02,
  idp_tkl: 3.24,
  idp_tkl_ast: 0.96,
  idp_tkl_loss: 0.9,
  idp_tkl_solo: 2.28,
  pts_half_ppr: 0.78,
  pts_ppr: 0.78,
  pts_std: 0.78,
}

describe('scoreStatLine — IDP vocabulary bridge', () => {
  it('scores a league already on the idp_ prefixed vocabulary', () => {
    // Real "NFC Dreaming!" settings.
    const scoring = { idp_tkl: 1, idp_tkl_solo: 1, idp_tkl_ast: 1.5, idp_tkl_loss: 1.5, idp_sack: 3, idp_ff: 3, idp_pass_def: 2 }
    const r = scoreStatLine(DEF_PROJECTION, scoring, 'ppr')
    expect(r.mode).toBe('league-scored')
    expect(r.points).toBeCloseTo(11.01, 1)
  })

  it('bridges a league on the bare tackle vocabulary instead of falling back to pts_ppr', () => {
    // Same weights, bare keys. Before the alias this matched nothing and returned
    // pts_ppr (0.78) — a defender scored as if offensive.
    const scoring = { tkl: 1, tkl_solo: 1, tkl_ast: 1.5, tkl_loss: 1.5, idp_sack: 3, idp_ff: 3, pass_def: 2 }
    const r = scoreStatLine(DEF_PROJECTION, scoring, 'ppr')
    expect(r.mode).toBe('league-scored')
    expect(r.points).toBeCloseTo(11.01, 1)
    expect(r.points).not.toBeCloseTo(0.78, 1)
  })

  it('does NOT alias team-defense keys onto an individual player', () => {
    // `sack`/`int`/`ff`/`fum_rec` are the DEF-unit settings every Sleeper league carries.
    // Measured: 45 of 57 leagues score exactly these and nothing else defensive. Treating
    // them as IDP would manufacture points for defenders in leagues that never roster them.
    const teamDefenseOnly = { sack: 4, int: 2, ff: 1, fum_rec: 2 }
    const r = scoreStatLine(DEF_PROJECTION, teamDefenseOnly, 'ppr')
    expect(r.mode).toBe('format-approx')
    expect(r.points).toBeCloseTo(0.78, 2)
  })

  it('prefers a league explicit key over the alias when both exist', () => {
    const scoring = { idp_tkl_solo: 2, tkl_solo: 99 }
    const r = scoreStatLine(DEF_PROJECTION, scoring, 'ppr')
    expect(r.points).toBeCloseTo(2.28 * 2, 2)
  })

  it('treats an explicit zero as scored-at-zero, not as missing', () => {
    // Real "Versuz" shape: tackles present and deliberately set to 0. The correct answer is
    // to award nothing for tackles, not to fall back to a format approximation.
    const scoring = { tkl: 0, tkl_solo: 0, tkl_ast: 0, tkl_loss: 0, idp_pass_def: 1 }
    const r = scoreStatLine(DEF_PROJECTION, scoring, 'ppr')
    expect(r.mode).toBe('league-scored')
    expect(r.points).toBeCloseTo(0.18, 2)
  })
})
