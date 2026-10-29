/**
 * Seeded, repeatable sample field for the divisions format — the same idea as the
 * handoff's generated sample (Angelic vs Demonic, 10 × 12 per division, week 9 of 10).
 *
 * ⚠ INVENTED DATA. Used by the dev preview page and tests only; every screen that
 * shows it says so. Never a fallback for a real tournament with no rows.
 */
import type { DivisionTeamInput } from './engine'
import { presetIdentity, type DivisionIdentity } from './identity'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STEMS = ['Blitz', 'Bootleg', 'Fourth', 'BigPlay', 'StiffArm', 'Wildcat', 'Redshirt', 'Nickel', 'Sack', 'Dime', 'Pylon', 'QB', 'Triple', 'Spiral', 'DeepPost', 'Screen', 'Fumble', 'HailMary', 'RPO', 'Mossed', 'Touchback', 'Punt', 'Audible', 'Onside', 'Coffee']
const TAILS = ['Capital', 'Raiders', 'Society', 'Crew', 'Gang', 'Wolves', 'Bandits', 'Nation', 'Club', 'Squad', 'Empire', 'Mafia', 'Dynasty', 'Legends', 'Theory', 'Hustle']

export type SampleTeam = DivisionTeamInput & { divisionIndex: 0 | 1; conferenceIndex: number }

export function sampleDivisionsField(seed = 2026, weeksPlayed = 9, conferences = 10, teamsPerConference = 12) {
  const rand = mulberry32(seed)
  const identity: DivisionIdentity = presetIdentity('angelic-demonic', conferences)
  const used = new Set<string>()
  const teams: SampleTeam[] = []
  for (const d of [0, 1] as const) {
    for (let c = 0; c < conferences; c++) {
      for (let i = 0; i < teamsPerConference; i++) {
        let name = ''
        for (let n = 0; !name || used.has(name); n++) name = STEMS[Math.floor(rand() * STEMS.length)]! + TAILS[Math.floor(rand() * TAILS.length)]! + (n > 3 ? String(n - 2) : '')
        used.add(name)
        const skill = 95 + rand() * 30
        let wins = 0, points = 0, best = 0
        for (let w = 0; w < weeksPlayed; w++) {
          const score = Math.round((skill + (rand() - 0.5) * 50) * 10) / 10
          points += score; best = Math.max(best, score)
          if (score + (rand() - 0.5) * 30 > 110) wins++
        }
        teams.push({ id: `d${d}-c${c}-t${i}`, name, conferenceId: `conf-${c}`, wins, losses: weeksPlayed - wins, points: Math.round(points * 10) / 10, bestWeek: best, divisionIndex: d, conferenceIndex: c })
      }
    }
  }
  return { identity, teams, weeksPlayed }
}
