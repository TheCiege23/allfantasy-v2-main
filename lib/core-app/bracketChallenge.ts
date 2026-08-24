import { prisma } from '@/lib/prisma'
import {
  SPORT_ORDER,
  SPORT_SHELLS,
  firstRoundPairs,
  seedsPerSide,
  toClientShell,
  type ClientSportShell,
  type SportKey,
} from '@/lib/brackets/sportShell'

/**
 * 28a — the bracket challenge, read from the team data we actually hold.
 *
 * ⚠ SEEDS ARE NOT INVENTED. Nothing in this database stores a postseason seed.
 * `SportsTeam` gives us the league a club plays in and its badge, and that is
 * all — so every slot comes back `team: null` until a real seeding source fills
 * it. The bracket is playable in that state on purpose (the handoff wants pools
 * forming before the postseason locks); what it must never do is guess an order
 * and let someone enter a pool against a made-up field.
 *
 * ⚠ THE TEAM POOL IS REAL. It reads `SportsTeam` for the sport, deduplicated
 * across providers, so the side labels and the club list a player sees are the
 * clubs that exist — not a hardcoded array that goes stale the next time a team
 * relocates or rebrands.
 *
 * ⚠ NEVER HARDCODE A LOGO URL FROM THIS TABLE INTO SOURCE OR A FIXTURE. Rolling
 * Insights serves badges from blob storage with a signed `sig=` query parameter
 * on the URL. Committing one commits a credential. Read them at request time,
 * always.
 */

export type BracketTeam = {
  id: string
  name: string
  shortName: string
  logo: string | null
}

export type BracketSlot = {
  seed: number
  /** Null until a seeding source exists — rendered as an open "?" slot. */
  team: BracketTeam | null
  /** True for a seed that sits out the first round. */
  bye: boolean
}

export type BracketSide = {
  label: string
  slots: BracketSlot[]
  /** First-round matchups by seed, outward-in. */
  pairs: Array<[number, number]>
}

export type SportOption = {
  key: SportKey
  label: string
  available: boolean
}

export type BracketChallengeData = {
  /*
   * The CLIENT shell — no RegExp. `SportShell.conferenceMatch` is server-only;
   * passing it to a client component throws "Only plain objects can be passed
   * to Client Components", which is exactly how this was caught.
   */
  shell: ClientSportShell
  sports: SportOption[]
  sides: [BracketSide, BracketSide]
  /** The clubs we hold for this sport, for the champion picker. */
  pool: BracketTeam[]
  /**
   * True while no seeding source exists. The screen states it rather than
   * showing an empty bracket that looks broken.
   */
  seedsPending: boolean
}

type TeamRow = {
  id: string
  name: string
  shortName: string | null
  logo: string | null
  conference: string | null
}

/**
 * Providers disagree about what `conference` means, and only one of them says
 * anything useful.
 *
 * Measured on the real MLB rows: Rolling Insights stores "American League -
 * East"; TheSportsDB stores "MLB" for all thirty clubs. Both carry a badge and
 * both use identical club names, so a dedupe that preferred "whichever row has
 * a logo" kept whichever sorted first — and every club that happened to keep
 * the TheSportsDB row then failed the side filter. That is how a thirty-team
 * league rendered a seventeen-team champion picker.
 *
 * So: a row that identifies which side of the draw a club is on beats a row
 * that does not, before any other consideration.
 */
function sideOf(conference: string | null, match: [RegExp, RegExp] | null): 0 | 1 | null {
  if (!match) return null
  const c = conference ?? ''
  if (match[0].test(c)) return 0
  if (match[1].test(c)) return 1
  return null
}

/**
 * Provider rosters include pseudo-teams that never play a postseason — Rolling
 * Insights carries "AL All-Stars" and "NL All-Stars" alongside the thirty real
 * clubs. They are excluded here rather than at render time so nothing
 * downstream can offer one as a champion.
 */
const NOT_A_CLUB = /\ball[-\s]?stars?\b/i

function dedupe(rows: TeamRow[], match: [RegExp, RegExp] | null): TeamRow[] {
  const byName = new Map<string, TeamRow>()
  const score = (r: TeamRow) =>
    // Side identification first — it is the only field that cannot be recovered
    // from another provider. Then a badge, then a short name.
    (sideOf(r.conference, match) !== null ? 4 : 0) + (r.logo ? 2 : 0) + (r.shortName ? 1 : 0)

  for (const row of rows) {
    if (NOT_A_CLUB.test(row.name)) continue
    const key = row.name.trim().toLowerCase()
    const existing = byName.get(key)
    if (!existing || score(row) > score(existing)) byName.set(key, row)
  }
  return [...byName.values()]
}

export async function getBracketChallenge(sport: SportKey): Promise<BracketChallengeData> {
  const shell = SPORT_SHELLS[sport]

  const rows = await prisma.sportsTeam
    .findMany({
      // Explicit select: this table has grown columns that break a bare read.
      where: { sport: shell.label.toUpperCase().replace('-', '') },
      select: { id: true, name: true, shortName: true, logo: true, conference: true },
      orderBy: { name: 'asc' },
    })
    .catch(() => [])

  const teams = dedupe(rows, shell.conferenceMatch)

  const toTeam = (r: (typeof teams)[number]): BracketTeam => ({
    id: r.id,
    name: r.name,
    shortName: r.shortName ?? r.name.slice(0, 3).toUpperCase(),
    logo: r.logo,
  })

  const per = seedsPerSide(shell)
  const pairs = firstRoundPairs(shell)

  const buildSide = (label: string): BracketSide => ({
    label,
    /*
     * Every slot is empty. See the note at the top of this file: there is no
     * seeding source, and a bracket that guesses is worse than one that waits.
     * The side's own club list is still real and drives the champion picker.
     */
    slots: Array.from({ length: per }, (_, i) => ({
      seed: i + 1,
      team: null,
      bye: shell.byeSeeds.includes(i + 1),
    })),
    pairs,
  })

  const sides: [BracketSide, BracketSide] = [buildSide(shell.sides[0]), buildSide(shell.sides[1])]

  /*
   * The champion picker offers every club in the sport. Where the conference
   * string identifies a side we keep only clubs that land on one — but if NO
   * club does (a sport whose provider gives us no side information), we keep
   * them all rather than returning an empty picker, which would read as "we
   * have no teams" when what we actually lack is a side label.
   */
  const sided = teams.filter((t) => sideOf(t.conference, shell.conferenceMatch) !== null)
  const pool = (shell.conferenceMatch && sided.length ? sided : teams).map(toTeam)

  return {
    shell: toClientShell(shell),
    sports: SPORT_ORDER.map((key) => ({
      key,
      label: SPORT_SHELLS[key].label,
      available: SPORT_SHELLS[key].available,
    })),
    sides,
    pool,
    seedsPending: true,
  }
}
