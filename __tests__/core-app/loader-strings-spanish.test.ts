import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

/*
 * The language switch is client state, and no /core loader reads it — so a sentence a loader writes
 * reaches a Spanish reader in English unless the screen translates it (2026-10-03 language audit).
 * Standings already passes these through `copy()`; three had no Spanish, and one is templated, which an
 * exact-match table cannot hold.
 *
 * Each case is pinned against the LOADER's source too: reword the loader and this goes red, instead of
 * the Spanish silently falling back to English.
 */

const STANDINGS = readFileSync(resolve(process.cwd(), 'lib/core-app/leagueStandings.ts'), 'utf8')

describe('Standings — why the projected total is withheld, in Spanish', () => {
  const fixed = [
    'we cannot tell which team in this league is yours',
    'the regular season is over — this is the final total',
    'this league has no head-to-head schedule, so there is no fixed number of weeks left to project',
  ]

  it.each(fixed)('the loader still writes "%s", and it has Spanish', (english) => {
    expect(STANDINGS).toContain(`'${english}'`)
    const es = coreUiCopy(english, 'es')
    expect(es).not.toBe(english)
    expect(es.length).toBeGreaterThan(10)
  })

  it('the templated pace reason keeps its numbers in Spanish', () => {
    expect(STANDINGS).toContain('`a pace needs at least ${MIN_WEEKS_TO_PROJECT} scored weeks behind it — you have ${youBoard.weeksPlayed}`')
    expect(coreUiCopy('a pace needs at least 3 scored weeks behind it — you have 2', 'es')).toBe(
      'un ritmo necesita al menos 3 semanas jugadas — llevas 2',
    )
  })

  it('English is untouched, and a sentence no pattern knows passes through unchanged', () => {
    expect(coreUiCopy('a pace needs at least 3 scored weeks behind it — you have 2', 'en')).toBe(
      'a pace needs at least 3 scored weeks behind it — you have 2',
    )
    expect(coreUiCopy('a sentence nobody wrote a pattern for', 'es')).toBe('a sentence nobody wrote a pattern for')
  })

  it('a pattern is anchored: a longer sentence that merely CONTAINS one is not half-translated', () => {
    const longer = 'note: a pace needs at least 3 scored weeks behind it — you have 2, so wait'
    expect(coreUiCopy(longer, 'es')).toBe(longer)
  })

  it('an exact dictionary entry still wins over patterns', () => {
    expect(coreUiCopy('Standings', 'es')).toBe('Clasificación')
  })
})

const BOARD = readFileSync(resolve(process.cwd(), 'lib/waivers/waiverBoard.ts'), 'utf8')
const RATE_BOARD = readFileSync(resolve(process.cwd(), 'lib/waivers/seasonRateWaiverBoard.ts'), 'utf8')
const BASIS = readFileSync(resolve(process.cwd(), 'lib/waivers/waiverSportBasis.ts'), 'utf8')
const INTEL = readFileSync(resolve(process.cwd(), 'lib/waiver-intel/waiverIntelService.ts'), 'utf8')

const es = (s: string) => coreUiCopy(s, 'es')

describe('Waivers "Worth adding" notes, in Spanish', () => {
  /** [a sentence exactly as the loader writes it, a fragment of its template the loader source must still hold] */
  const cases: Array<[string, string, string]> = [
    [
      'Ranked by how much each adds to your best starting lineup, not by raw projection — a big name who would not crack your lineup is worth nothing this week.',
      BOARD,
      'a big name who would not crack your lineup is worth nothing this week.',
    ],
    [
      'Ranked by how much each adds to your best starting lineup per game, not by raw projection — a big name who would not crack your lineup is worth nothing here.',
      RATE_BOARD,
      'a big name who would not crack your lineup is worth nothing here.',
    ],
    ['No recent game data to build a free-agent pool from.', BOARD, 'No recent game data to build a free-agent pool from.'],
    ['No available player can fill a starting slot in this league.', BOARD, 'No available player can fill a starting slot in this league.'],
    [
      'None of your rostered players could be projected under this league’s scoring.',
      BOARD,
      'None of your rostered players could be projected under this league’s scoring.',
    ],
    [
      "A claim made now is for week 5, so these are Sleeper's week 5 projections, rescored under this league's scoring — published ahead, they move as injuries and depth charts settle. A player with no week 5 line (most often a bye) is not shown.",
      BOARD,
      'published ahead, they move as injuries and depth charts settle. ',
    ],
    ['14 free agents would improve your lineup; showing the top 10.', BOARD, 'free agents would improve your lineup; showing the top'],
    ['74 free agents are ruled out, on injured reserve or on a bye this week and not shown.', BOARD, 'ruled out, on injured reserve or on a bye this week and not shown.'],
    ['1 free agent is ruled out, on injured reserve or on a bye this week and not shown.', BOARD, "outFreeAgents.size === 1 ? ' is' : 's are'"],
    ['229 of 422 startable free agents could not be projected under this league’s scoring and are not shown.', BOARD, 'startable free agents could not be '],
    [
      '206 of 422 startable free agents have no projection and no game this season that this league’s scoring counts, so there is nothing to rank them on.',
      BOARD,
      'that this league’s scoring counts, so there is nothing to rank them on.',
    ],
    ['1 more has no projection and only one counting game this season — too few to rank, so he is not shown.', BOARD, "no projection and only one counting game this season — "],
    ['23 more have no projection and only one counting game this season — too few to rank, so they are not shown.', BOARD, "too few to rank, so ${split.once === 1 ? 'he is' : 'they are'} not shown."],
    ['1620 other active players were skipped because no slot in this league can hold them.', BOARD, 'other active players were skipped because no slot in this league can hold them.'],
    ['12 other projected players were skipped because no slot in this league can hold them.', RATE_BOARD, 'other projected players were skipped because no slot in this league can hold them.'],
    [
      "3 projected NBA players could not be matched to this league's player ids, so we cannot tell whether they are free agents and they are not shown.",
      RATE_BOARD,
      "players could not be matched to this league's player ids, so we cannot tell ",
    ],
    ["Weekly projections, re-scored under each league's own scoring_settings.", BASIS, "Weekly projections, re-scored under each league's own scoring_settings."],
    [
      "Per-game rates from AllFantasy's NBA season projection, re-scored under each league's own scoring_settings. A season rate, not a projection for this week.",
      BASIS,
      "season projection, re-scored under each league's own scoring_settings. ",
    ],
    [
      "Per-game points from AllFantasy's NBA season projection, on AllFantasy's default NBA scoring — not each league's own rules, which are written in a stat vocabulary the projection engine does not read yet. A season rate, not a projection for this week.",
      BASIS,
      'not each league\'s own rules, which are written in a stat vocabulary the projection engine does not read yet. ',
    ],
  ]

  it.each(cases)('"%s" has Spanish, and the loader still writes it', (english, source, fragment) => {
    expect(source).toContain(fragment)
    const out = es(english)
    expect(out).not.toBe(english)
    // Every number in the English survives into the Spanish.
    for (const n of english.match(/\d+/g) ?? []) expect(out).toContain(n)
  })

  it('the lock sentence translates part by part, in every combination, joined with "y"', () => {
    expect(BOARD).toContain('Games already kicked off are locked in: ${listed}.')
    expect(es('Games already kicked off are locked in: 1 bench player can no longer come in and 13 free agents whose game has started are not shown.')).toBe(
      'Los partidos que ya empezaron quedan fijos: 1 jugador de la banca ya no puede entrar y no se muestran 13 agentes libres cuyo partido ya empezó.',
    )
    expect(es('Games already kicked off are locked in: 1 of your starters keeps his slot and 1 free agent whose game has started is not shown.')).toBe(
      'Los partidos que ya empezaron quedan fijos: 1 de tus titulares conserva su puesto y no se muestra 1 agente libre cuyo partido ya empezó.',
    )
    expect(es('Games already kicked off are locked in: 2 of your starters keep their slots, 3 bench players can no longer come in, and 4 free agents whose game has started are not shown.')).toBe(
      'Los partidos que ya empezaron quedan fijos: 2 de tus titulares conservan sus puestos, 3 jugadores de la banca ya no pueden entrar y no se muestran 4 agentes libres cuyo partido ya empezó.',
    )
    expect(es('Games already kicked off are locked in: 2 bench players can no longer come in.')).toBe(
      'Los partidos que ya empezaron quedan fijos: 2 jugadores de la banca ya no pueden entrar.',
    )
  })

  it('a lock sentence with a part it does not know stays wholly English — never half-translated', () => {
    const odd = 'Games already kicked off are locked in: 1 bench player can no longer come in and something new happened.'
    expect(es(odd)).toBe(odd)
  })
})

describe('Waivers empty states and Waiver Intelligence reasons, in Spanish', () => {
  const COMPONENT = readFileSync(resolve(process.cwd(), 'components/core-app/WaiverLineupBoard.tsx'), 'utf8')

  it.each([
    'we cannot tell which roster in this league is yours',
    'no roster rows imported for your team yet',
    'this league publishes no scoring settings, so nothing here can be priced',
    'this league publishes no starting slots, so there is no lineup to improve',
    'nothing on your roster could be projected under this league’s scoring yet',
    'nothing projects this sport’s players yet, so this wire cannot be priced',
    'nobody on the wire would improve your starting lineup this week',
    'nobody on the wire would improve your starting lineup per game',
  ])('"%s" is the component’s and has Spanish', (english) => {
    expect(COMPONENT).toContain(english)
    expect(es(english)).not.toBe(english)
  })

  it('the foreign-ids state, which the component lower-cases from a shared constant', () => {
    expect(es("this league's player ids can't be matched to ours yet")).not.toBe("this league's player ids can't be matched to ours yet")
  })

  it('the two "cannot play this week" reason lines', () => {
    expect(INTEL).toContain("'on bye this week — he cannot score for you until next week'")
    expect(INTEL).toContain('— he cannot play this week, so any bid is a stash')
    expect(es('on bye this week — he cannot score for you until next week')).toBe('descansa esta semana: no puede sumarte puntos hasta la próxima')
    expect(es('IR — he cannot play this week, so any bid is a stash')).toBe('IR: no puede jugar esta semana, así que cualquier oferta es para guardarlo')
  })
})

describe('Scout — what its loaders write, in Spanish', () => {
  const SCOUT = readFileSync(resolve(process.cwd(), 'lib/core-app/scout.ts'), 'utf8')
  const EDGE = readFileSync(resolve(process.cwd(), 'lib/competitive-edge/scoutEdgeLoader.ts'), 'utf8')
  const WAIVER_EDGE = readFileSync(resolve(process.cwd(), 'lib/competitive-edge/waiverEdgeLoader.ts'), 'utf8')
  const MODEL = readFileSync(resolve(process.cwd(), 'lib/core-app/standingsModel.ts'), 'utf8')

  /** [a sentence exactly as a loader writes it, that loader's source, a fragment the source must still hold] */
  const cases: Array<[string, string, string]> = [
    ['membership in this league could not be checked just now — try again in a moment', SCOUT, "'membership in this league could not be checked just now — try again in a moment'"],
    ['scouting reads the managers of a league you are in, and this account is not a member of this one', SCOUT, 'scouting reads the managers of a league you are in'],
    ['the teams in this league could not be read just now — try again in a moment', SCOUT, "'the teams in this league could not be read just now — try again in a moment'"],
    ['no teams have been imported for this league, so there is nobody to scout', SCOUT, "'no teams have been imported for this league, so there is nobody to scout'"],
    ['the standings could not be read just now, so the table order and records are missing', SCOUT, "'the standings could not be read just now, so the table order and records are missing'"],
    ['no weekly results have been synced for this league yet — the board is built from scored weeks, and there are none on file', STANDINGS, 'no weekly results have been synced for this league yet'],
    ['this league has no platform id on file, and the weekly results this board is built from are stored against the provider’s id rather than ours', STANDINGS, 'this league has no platform id on file'],
    [
      'nothing has been scored in 2026 yet. The full schedule is already on file, so there are rows for every week — but ranking them would order twelve teams that have all scored nothing.',
      STANDINGS,
      'but ranking them would order twelve teams that have all scored nothing.',
    ],
    ['membership in this league could not be checked just now', EDGE, "'membership in this league could not be checked just now'"],
    ['Competitive Edge reads the managers of a league you are in', EDGE, "'Competitive Edge reads the managers of a league you are in'"],
    ['this league could not be read', EDGE, "'this league could not be read'"],
    ["Competitive Edge reads Sleeper trade and waiver history today, and ESPN leagues aren't connected yet", EDGE, "leagues aren't connected yet`"],
    ['the waiver history could not be read just now', EDGE, "'the waiver history could not be read just now'"],
    ["this league's trade history hasn't been read yet — it loads with the league's Trades screen", EDGE, "it loads with the league's Trades screen"],
    ['Competitive Edge could not be read right now', EDGE, "'Competitive Edge could not be read right now'"],
    ['This league could not be read.', WAIVER_EDGE, "'This league could not be read.'"],
    ["Competitive Edge reads Sleeper waiver history today. ESPN leagues aren't connected yet.", WAIVER_EDGE, 'Competitive Edge reads Sleeper waiver history today.'],
    ['Competitive Edge could not be read right now.', WAIVER_EDGE, "'Competitive Edge could not be read right now.'"],
    ["Order is Sleeper's reported standings.", MODEL, "`Order is ${P}'s reported standings.`"],
    ["Order is winning percentage, then points for, then head-to-head — Sleeper's rule.", MODEL, "Order is winning percentage, then points for, then head-to-head"],
    ['Order is winning percentage, then points for, then head-to-head — assumed, because ESPN does not report its tiebreaker to us.', MODEL, 'does not report its tiebreaker to us'],
    ['Order is total points for.', MODEL, "'Order is total points for.'"],
  ]

  it.each(cases)('"%s" has Spanish, and the loader still writes it', (english, source, fragment) => {
    expect(source).toContain(fragment)
    const out = es(english)
    expect(out).not.toBe(english)
    for (const n of english.match(/\d+/g) ?? []) expect(out).toContain(n)
    // A platform named in the English is named in the Spanish too.
    for (const p of english.match(/\b(Sleeper|ESPN)\b/g) ?? []) expect(out).toContain(p)
  })
})
