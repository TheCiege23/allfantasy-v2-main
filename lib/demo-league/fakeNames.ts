/**
 * Fake identity pools for the public demo league.
 *
 * Every name here is invented. They are deliberately generic fantasy-sports
 * flavoured strings, so none of them reads as a real person and none collides
 * with a plausible real username. The pools are large enough that a 32-team
 * league never repeats a team name or a manager name.
 *
 * ⚠ ORDER IS PART OF THE CONTRACT. An alias row stores the pool INDEX it was
 * given, not only the rendered string, so appending is safe and reordering or
 * deleting an entry silently renames every demo team that held a later index.
 * Append only.
 */

export const FAKE_TEAM_NAMES: readonly string[] = [
  'Gridiron Ghosts',
  'Fourth & Forever',
  'Red Zone Rebels',
  'Waiver Wire Wizards',
  'Blitz Brigade',
  'Hail Mary Heroes',
  'End Zone Envoys',
  'Two-Point Titans',
  'Pocket Passers',
  'Turf Monsters',
  'Sunday Sorcerers',
  'Fumble Recovery Crew',
  'Bench Mob Bandits',
  'Playoff Prowlers',
  'Draft Day Dynamos',
  'Bye Week Bruisers',
  'Gold Jacket Gang',
  'Monday Night Mavericks',
  'Taxi Squad Tycoons',
  'Flex Position Phantoms',
  'Late Round Legends',
  'Sleeper Pick Society',
  'Trade Deadline Thieves',
  'Pylon Pirates',
  'Shotgun Formation',
  'Nickel Package',
  'Screen Pass Syndicate',
  'Goal Line Guardians',
  'Overtime Outlaws',
  'Kickoff Kings',
  'Audible Assassins',
  'Hurry-Up Offense',
  'Statline Stampede',
  'Box Score Bandits',
  'Spread Offense Squad',
  'Zone Read Rangers',
] as const

const FAKE_FIRST: readonly string[] = [
  'Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Quinn', 'Avery',
  'Parker', 'Reese', 'Skyler', 'Rowan', 'Emerson', 'Finley', 'Hayden', 'Jamie',
  'Kendall', 'Logan', 'Marlowe', 'Peyton', 'Sage', 'Tatum', 'Blake', 'Drew',
  'Ellis', 'Harper', 'Jules', 'Lane', 'Remy', 'Shay', 'Toby', 'Wren',
  'Ari', 'Bowie', 'Cruz', 'Devon',
] as const

const FAKE_LAST_INITIAL: readonly string[] = [
  'B.', 'C.', 'D.', 'F.', 'G.', 'H.', 'J.', 'K.', 'L.', 'M.', 'N.', 'P.',
  'R.', 'S.', 'T.', 'V.', 'W.', 'Y.', 'Z.', 'A.', 'E.', 'I.', 'O.', 'Q.',
  'U.', 'X.', 'B.', 'C.', 'D.', 'F.', 'G.', 'H.', 'J.', 'K.', 'L.', 'M.',
] as const

/** Fake manager names are "Demo <First> <Initial>" so they can never be mistaken for a real handle. */
export function fakeManagerName(index: number): string {
  const i = Math.abs(Math.trunc(index))
  const first = FAKE_FIRST[i % FAKE_FIRST.length]!
  const last = FAKE_LAST_INITIAL[(i * 7 + 3) % FAKE_LAST_INITIAL.length]!
  const lap = Math.floor(i / FAKE_FIRST.length)
  return lap === 0 ? `Demo ${first} ${last}` : `Demo ${first} ${last} ${lap + 1}`
}

export function fakeTeamName(index: number): string {
  const i = Math.abs(Math.trunc(index))
  const base = FAKE_TEAM_NAMES[i % FAKE_TEAM_NAMES.length]!
  const lap = Math.floor(i / FAKE_TEAM_NAMES.length)
  return lap === 0 ? base : `${base} ${lap + 1}`
}

/** Pool size before names start repeating with a numeric suffix. */
export const FAKE_POOL_SIZE = FAKE_TEAM_NAMES.length

export const DEMO_LEAGUE_DISPLAY_NAME = 'AllFantasy Demo League'

/** Palette for generated initials avatars. Hex only — no image URL is ever sent for a demo team. */
const AVATAR_COLORS: readonly string[] = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04',
  '#16a34a', '#0d9488', '#0891b2', '#4f46e5', '#9333ea', '#c026d3',
] as const

export function fakeAvatarColor(index: number): string {
  return AVATAR_COLORS[Math.abs(Math.trunc(index)) % AVATAR_COLORS.length]!
}

/** Two-letter initials from a fake team name, e.g. "Gridiron Ghosts" -> "GG". */
export function fakeInitials(teamName: string): string {
  const parts = teamName.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map((p) => p[0]!.toUpperCase())
  return letters.join('') || 'DL'
}
