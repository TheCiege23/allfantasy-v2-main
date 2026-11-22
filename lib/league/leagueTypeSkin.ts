/**
 * Which look a league page wears: one skin per league type, so a Dynasty league reads gold, a Survivor
 * league reads ember, a Zombie league reads toxic green, and so on.
 *
 * The page stamps the answer as `data-league-skin` (plus `data-league-sport` for redraft, which is
 * coloured by sport the same way /core's redraft identity is), and
 * components/league/league-type-skin.css turns it into `--lsk-*` tokens. Nothing here is a colour:
 * this file only decides WHICH skin, and the copy that names it.
 *
 * Order matters. Specialty formats win over the base format, because a guillotine league that keeps
 * its rosters is still a guillotine league to the person playing it. Dynasty is decided by the one
 * shared predicate, `isDynastyLeague`, never by reading `leagueType` alone.
 */
import { isDynastyLeague } from '@/lib/league/isDynastyLeague'

export const LEAGUE_SKINS = [
  'dynasty',
  'redraft',
  'keeper',
  'best_ball',
  'guillotine',
  'survivor',
  'devy',
  'c2c',
  'zombie',
  'salary_cap',
  'pirate',
  'big_brother',
] as const

export type LeagueSkin = (typeof LEAGUE_SKINS)[number]

export const REDRAFT_SKIN_SPORTS = ['nfl', 'nba', 'nhl', 'mlb', 'ncaaf', 'ncaab', 'soccer'] as const
export type RedraftSkinSport = (typeof REDRAFT_SKIN_SPORTS)[number]

export type LeagueSkinFields = {
  leagueType?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean | null
  format?: string | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
}

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()

export function resolveLeagueSkin(league: LeagueSkinFields | null | undefined): LeagueSkin {
  if (!league) return 'redraft'
  const type = lower(league.leagueType)
  const variant = lower(league.leagueVariant)
  const either = (...ids: string[]) => ids.includes(type) || ids.includes(variant)

  if (either('survivor', 'survivor_guillotine')) return 'survivor'
  if (either('big_brother')) return 'big_brother'
  if (either('zombie')) return 'zombie'
  if (either('pirate')) return 'pirate'
  if (league.guillotineMode || either('guillotine')) return 'guillotine'
  if (league.bestBallMode || either('best_ball', 'bestball')) return 'best_ball'
  // C2C and Devy are different formats, labelled apart (owner, 2026-11-21). Peach Bowl is
  // `leagueType: 'c2c'` and used to wear the Devy label.
  if (either('c2c', 'merged_devy_c2c')) return 'c2c'
  if (either('devy', 'devy_dynasty')) return 'devy'
  if (either('salary_cap')) return 'salary_cap'
  if (either('keeper')) return 'keeper'
  if (isDynastyLeague(league)) return 'dynasty'
  return 'redraft'
}

/** Redraft is coloured by sport; anything unrecognised falls back to NFL's green. */
export function redraftSkinSport(sport: unknown): RedraftSkinSport {
  const s = lower(sport)
  return (REDRAFT_SKIN_SPORTS as readonly string[]).includes(s) ? (s as RedraftSkinSport) : 'nfl'
}

export type LeagueSkinCopy = {
  /** The type's name, as a chip and hero kicker. */
  label: string
  /** One sentence that says what makes this format different. */
  tagline: string
  /** Initial drawn in the hero crest. */
  mark: string
}

export const LEAGUE_SKIN_COPY: Record<LeagueSkin, LeagueSkinCopy> = {
  dynasty: { label: 'Dynasty', mark: 'D', tagline: 'Rosters carry over. Every pick is an asset. Titles are forever.' },
  redraft: { label: 'Redraft', mark: 'R', tagline: 'One season, start to finish. Every week counts the same.' },
  keeper: { label: 'Keeper', mark: 'K', tagline: 'Keep your best players into next season. The rest go back in the draft.' },
  best_ball: { label: 'Best Ball', mark: 'B', tagline: 'No lineups to set. Your highest scorers count every week.' },
  guillotine: { label: 'Guillotine', mark: 'G', tagline: 'The lowest score each week is cut, and their roster goes to waivers.' },
  survivor: { label: 'Survivor', mark: 'S', tagline: 'Score to stay safe. Lose the week and face the vote.' },
  devy: { label: 'Devy', mark: 'D', tagline: 'Draft college players now. Promote them when they go pro.' },
  c2c: { label: 'C2C', mark: 'C', tagline: 'A college team and a pro team, run as one franchise.' },
  zombie: { label: 'Zombie', mark: 'Z', tagline: 'Lose to a zombie and you turn. The last human standing wins.' },
  salary_cap: { label: 'Salary Cap', mark: '$', tagline: 'Every contract counts against the cap, this year and next.' },
  pirate: { label: 'Pirate', mark: 'P', tagline: 'Players can be stolen. Protect the ones you cannot lose.' },
  big_brother: { label: 'Big Brother', mark: 'B', tagline: 'Win Head of Household, name the nominees, survive the eviction vote.' },
}
