/**
 * The bye week a drafted player lands with.
 *
 * 🛑 THE PICK'S OWN `byeWeek` IS PASSTHROUGH, NOT A SOURCE. `PickSubmissionService` writes whatever
 * `input.byeWeek` its caller sent and nothing looks one up. Measured on production 2026-09-05:
 *
 *     draft picks                 5,652
 *     carrying a bye                  2
 *     agreeing with the schedule      0     <- both wrong
 *         ATL: pick said 5, schedule says 11
 *         PHI: pick said 9, schedule says 10
 *
 * Both were unmatched picks in a manual draft, carrying a synthetic
 * `draft:<session>:<n>:<slug>:<pos>` player id — so the team and the week arrived as free text.
 * Hence the schedule leads here and the pick is only the fallback, which is the OPPOSITE order to
 * the materializer's: there the per-player source is a real product view that survives a mid-season
 * trade, and here it is input with a 0-for-2 record.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { byeForTeam } from '@/lib/schedule/teamByeWeeks'

/*
 * The precedence expression from `finalizeDraftToRedraftSeason`, exercised directly. Driving the
 * whole finalizer would mean standing up a draft session, a redraft season, roster mappings and a
 * dozen prisma delegates to assert one `??` chain — a fixture that large tests the fixture. The
 * derivation itself is covered by `__tests__/schedule/teamByeWeeks.test.ts`.
 */
const resolveBye = (
  byes: Map<string, number>,
  pick: { team: string | null; byeWeek: number | null },
): number | null => byeForTeam(byes, pick.team) ?? pick.byeWeek ?? null

const BYES = new Map([['ATL', 11], ['PHI', 10], ['GB', 11]])

describe('the bye a drafted player lands with', () => {
  it('🛑 the schedule overrides a pick that disagrees — the real ATL case', () => {
    // Production held exactly this row: Bijan Robinson, ATL, pick said bye 5.
    expect(resolveBye(BYES, { team: 'ATL', byeWeek: 5 })).toBe(11)
  })

  it('🛑 and the real PHI case', () => {
    // Saquon Barkley, PHI, pick said bye 9.
    expect(resolveBye(BYES, { team: 'PHI', byeWeek: 9 })).toBe(10)
  })

  it('fills the 5,650 picks that carry no bye at all', () => {
    expect(resolveBye(BYES, { team: 'GB', byeWeek: null })).toBe(11)
  })

  it('falls back to the pick when the schedule does not cover that team', () => {
    /*
     * Only NFL and NCAAF have regular-season rows in `SportsGame`; MLB, NBA, NHL, NCAAB and SOCCER
     * have none. For those the map is empty, and a value the caller supplied is better than
     * nothing — it is only DEMOTED here, not discarded.
     */
    expect(resolveBye(new Map(), { team: 'GB', byeWeek: 9 })).toBe(9)
  })

  it('🛑 stays null for a player with no team rather than inventing a week', () => {
    // Free agents: 9 of 214 on the measured league carry `team = null`.
    expect(resolveBye(BYES, { team: null, byeWeek: null })).toBeNull()
  })

  it('still uses the pick when there is no team but the caller supplied a week', () => {
    expect(resolveBye(BYES, { team: null, byeWeek: 7 })).toBe(7)
  })
})

describe('🛑 the expression above is a COPY, so the source is checked too', () => {
  /*
   * Everything above exercises a re-implementation of the precedence chain. That is worth having —
   * it pins what the ORDER should be — but on its own it is a test of itself: change the finalizer
   * and it stays green. This block asserts the finalizer really carries that order, which is the
   * half that can actually regress.
   */
  const SRC = readFileSync(
    join(process.cwd(), 'lib/redraft/finalizeDraftToRedraftSeason.ts'),
    'utf8',
  )

  it('is reading the right file', () => {
    // Positive control: a scan that matched nothing would satisfy every assertion below vacuously.
    /*
     * ⚠ THE EXPORT IS `syncCompletedDraftToRedraftSeason`; the FILE is
     * `finalizeDraftToRedraftSeason.ts`. They differ, and asserting the filename here failed —
     * which is the control doing its job on my own wrong assumption rather than on a broken read.
     */
    expect(SRC).toContain('syncCompletedDraftToRedraftSeason')
    expect(SRC).toContain('acquisitionType')
  })

  it('derives the schedule byes once, outside the pick loop', () => {
    expect(SRC).toContain('resolveTeamByeWeeks(')
    const derive = SRC.indexOf('resolveTeamByeWeeks(')
    const loop = SRC.indexOf('for (const pick of session.picks')
    expect(derive).toBeGreaterThan(-1)
    expect(loop).toBeGreaterThan(-1)
    // One query for the league, not one per pick.
    expect(derive).toBeLessThan(loop)
  })

  it('🛑 writes the schedule value AHEAD of the pick value', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).toMatch(/byeWeek:\s*byeForTeam\(byeByTeam,\s*pick\.team\)\s*\?\?\s*pick\.byeWeek/)
    // And the bare passthrough must not come back.
    expect(code).not.toMatch(/byeWeek:\s*pick\.byeWeek\s*\?\?\s*null/)
  })

  it('🛑 uses the LEAGUE sport, not season.sport', () => {
    /*
     * `leagueSportToConfigSport` maps NCAAF to "NCAAFB" and `SportsGame.sport` stores "NCAAF", so
     * the config key would silently match nothing for the one NCAAF league on file.
     */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const call = /resolveTeamByeWeeks\(([\s\S]{0,160}?)\)/.exec(code)
    expect(call).not.toBeNull()
    expect(call![1]).not.toContain('season.sport')
  })
})
