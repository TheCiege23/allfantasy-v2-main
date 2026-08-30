import { describe, expect, it } from 'vitest'

import { buildNameIndex, resolveVerifiedMatch } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

/*
 * `SportsInjury.team` holds TWO VOCABULARIES IN ONE COLUMN, and the home
 * dashboard's injury book is where that bites.
 *
 * Measured on production 2026-08-30: of 6,550 NFL rows, 3,013 store a code
 * ("ARI") and 3,537 store the full name ("Arizona Cardinals"). Both spellings
 * are present for the same clubs — `SELECT DISTINCT team` returns "ARI", "ATL",
 * "Arizona Cardinals" and "Atlanta Falcons" side by side.
 *
 * ⚠ WHY IT IS NOT COSMETIC. `resolveVerifiedMatch` narrows by team only when a
 * name has SEVERAL candidates, and 1,016 of 1,536 distinct NFL injury names do.
 * When the narrowing fails the verdict is `ambiguous`, and `dash34.ts` treats
 * that as "we hold nothing" — so the player drops out of the injury book. The
 * failure renders as a HEALTHY player, not as a wrong badge, which is the more
 * expensive of the two and the harder to notice.
 *
 * The fix folds both sides to one vocabulary at the dash34 call site rather
 * than inside `verifiedNameMatch`, which has four other callers and no reason
 * to know about an NFL club table. These tests pin the behaviour that fix
 * depends on.
 */

/** Two NFL players who genuinely share a name — the case that needs narrowing. */
const COLLIDING_INJURY_ROWS = [
  { name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', row: 'qb-row' },
  { name: 'Josh Allen', position: 'LB', team: 'Jacksonville Jaguars', row: 'lb-row' },
]

describe('injury index — club vocabulary', () => {
  /*
   * The regression, stated as the matcher actually behaves. `normalizeToken`
   * inside verifiedNameMatch is a bare `trim().toUpperCase()`, so "JAX" and
   * "JACKSONVILLE JAGUARS" are simply different strings.
   */
  it('fails to narrow when the two sides use different vocabularies', () => {
    const index = buildNameIndex(COLLIDING_INJURY_ROWS)
    const got = resolveVerifiedMatch(index, { name: 'Josh Allen', team: 'JAX' })
    expect(got.match).toBeNull()
    expect(got.reason).toBe('ambiguous')
  })

  it('narrows once both sides are folded to the same vocabulary', () => {
    const index = buildNameIndex(
      COLLIDING_INJURY_ROWS.map((r) => ({ ...r, team: normalizeTeamAbbrev(r.team) })),
    )
    const got = resolveVerifiedMatch(index, { name: 'Josh Allen', team: 'JAX' })
    expect(got.match?.row).toBe('lb-row')
    expect(got.reason).toBe('team_verified')
  })

  /*
   * And the mirror case, because the column holds both spellings: a feed row
   * that already stored a code has to keep matching after the fold.
   */
  it('still narrows when the feed row already stored a code', () => {
    const index = buildNameIndex(
      [
        { name: 'Josh Allen', position: 'QB', team: 'BUF', row: 'qb-row' },
        { name: 'Josh Allen', position: 'LB', team: 'JAX', row: 'lb-row' },
      ].map((r) => ({ ...r, team: normalizeTeamAbbrev(r.team) })),
    )
    expect(resolveVerifiedMatch(index, { name: 'Josh Allen', team: 'BUF' }).match?.row).toBe(
      'qb-row',
    )
  })

  /*
   * ⚠ THE FOLD MUST BE SAFE FOR THE SPORTS IT DOES NOT KNOW. `normalizeTeamAbbrev`
   * passes a non-NFL club through upper-cased — which is exactly what the
   * matcher's own `normalizeToken` does to the lookup side — so an NBA row is
   * left matching on the same terms it did before.
   */
  it('leaves a non-NFL club matching on the terms it always did', () => {
    const index = buildNameIndex(
      [
        { name: 'Jalen Johnson', position: 'PF', team: 'Atlanta Hawks', row: 'atl' },
        { name: 'Jalen Johnson', position: 'SG', team: 'Boston Celtics', row: 'bos' },
      ].map((r) => ({ ...r, team: normalizeTeamAbbrev(r.team) })),
    )
    const got = resolveVerifiedMatch(index, { name: 'Jalen Johnson', team: 'Atlanta Hawks' })
    expect(got.match?.row).toBe('atl')
  })

  /*
   * Position narrowing must survive untouched — it runs BEFORE team narrowing
   * and resolves this pair on its own. Pinned so a future change to the team
   * side cannot quietly become load-bearing for the position side.
   */
  it('still resolves on position alone, with no team on either side', () => {
    const index = buildNameIndex(COLLIDING_INJURY_ROWS)
    const got = resolveVerifiedMatch(index, { name: 'Josh Allen', position: 'QB' })
    expect(got.match?.row).toBe('qb-row')
    expect(got.reason).toBe('position_verified')
  })

  /*
   * A refusal is still a refusal. Folding narrows the vocabulary gap; it must
   * not invent a bind when the lookup genuinely cannot be told apart — that is
   * the whole point of this matcher.
   */
  it('still refuses when neither position nor team can separate the candidates', () => {
    const index = buildNameIndex(COLLIDING_INJURY_ROWS)
    expect(resolveVerifiedMatch(index, { name: 'Josh Allen' }).reason).toBe('ambiguous')
  })
})
