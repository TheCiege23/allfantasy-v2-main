/**
 * Public, indexable landers for each league format: /league-types and /league-types/<slug>.
 *
 * WHY THESE EXIST. Every specialty format's bare path (/bestball, /survivor, /zombie,
 * /big-brother, /devy, /c2c, /idp, /survivor-guillotine) 404s, and the per-format demos at
 * /demo/formats/<id> are `noindex` on purpose (they show invented teams). So a search for
 * "guillotine league" or "devy league" had nothing of ours to land on.
 *
 * ⚠ WHAT IS WRITTEN HERE AND WHAT IS NOT.
 *   - Rules come from the demo registry (`FORMAT_DEMO_META`), whose own header says it follows
 *     the code rather than the docs and states no disputed number. They are not restated here.
 *   - The SPORTS list is never typed into copy. It is computed from the create-league catalog at
 *     render (see `getLeagueTypeSports`), because the two sources in this repo disagree.
 *   - What this file adds — titles, the search phrasing, one-line intros and FAQs — repeats no
 *     number the rules already give ("say each number once") and adds none of its own.
 */
import { FORMAT_DEMO_META } from '@/lib/demo-league/formats/registry'
import type { FormatDemoMeta } from '@/lib/demo-league/formats/types'
import type { RequestableFormat } from '@/lib/create-league-v2/requestedFormat'
import { getAllowedSportsForLeagueType } from '@/lib/league-creation-wizard/league-type-registry'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'
import type { LeagueSport } from '@prisma/client'
import { IDP_SUPPORTED_SPORTS, SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { isSurvivorCreationSportAvailable } from '@/lib/survivor/survivorCreationAvailability'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import type { SportSlug } from '@/lib/seo-landing/config'

export type LeagueTypeSlug =
  | 'best-ball'
  | 'guillotine'
  | 'survivor'
  | 'survivor-guillotine'
  | 'zombie'
  | 'big-brother'
  | 'devy'
  | 'c2c'
  | 'idp'
  | 'dynasty'
  | 'keeper'
  | 'salary-cap'
  | 'pirate'

export interface LeagueTypePage {
  slug: LeagueTypeSlug
  /** The id in FORMAT_DEMO_META — also the /demo/formats/<id> sample. */
  demoId: string
  /** What /create-league?type= receives. */
  wizardType: RequestableFormat
  /** Short name used in links and buttons ("Start a free Guillotine league"). */
  name: string
  h1: string
  /** <title>. Leads with the phrase people search, not the product's nickname. */
  title: string
  description: string
  /** First paragraph: what the format is, in the words a searcher uses. */
  intro: string
  forWho: string
  faqs: Array<{ q: string; a: string }>
  related: LeagueTypeSlug[]
}

export const LEAGUE_TYPE_PAGES: LeagueTypePage[] = [
  {
    slug: 'best-ball',
    demoId: 'best-ball',
    wizardType: 'best_ball',
    name: 'Best Ball',
    h1: 'Best Ball Fantasy Leagues',
    title: 'Best Ball Fantasy Leagues – Draft and Done | AllFantasy',
    description:
      'Start a free best ball league. Draft once and your highest-scoring lineup is set for you every week, with no start/sit decisions.',
    intro:
      'In a best ball league you draft a team and never set a lineup. Each week AllFantasy counts your highest-scoring legal lineup for you.',
    forWho: 'For managers who love draft night but do not want to check lineups every week.',
    faqs: [
      {
        q: 'Do I ever need to set a lineup?',
        a: 'No. Your best possible lineup is picked automatically after the games, so a bench player who goes off still counts.',
      },
    ],
    related: ['guillotine', 'dynasty', 'salary-cap'],
  },
  {
    slug: 'guillotine',
    demoId: 'guillotine',
    wizardType: 'guillotine',
    name: 'Guillotine',
    h1: 'Guillotine Fantasy Leagues',
    title: 'Guillotine Fantasy League – Lowest Score Is Chopped | AllFantasy',
    description:
      'Start a free guillotine league. No matchups: each week the lowest score in the league is chopped and that roster hits waivers, until one team is left.',
    intro:
      'A guillotine league (we call it Guilly) has no head-to-head matchups. Every week the lowest score in the whole league is eliminated, and that team’s players go to waivers.',
    forWho: 'For leagues that want every single week to matter, from the first game to the last.',
    faqs: [
      {
        q: 'Is there a schedule or head-to-head opponent?',
        a: 'No. You are only racing the rest of the league to stay off the bottom of that week’s scores.',
      },
      {
        q: 'How is this different from Survivor Guillotine?',
        a: 'Guillotine is every manager for themselves. Survivor Guillotine adds tribes, immunity and hidden powers on top of the weekly chop.',
      },
    ],
    related: ['survivor-guillotine', 'survivor', 'zombie'],
  },
  {
    slug: 'survivor',
    demoId: 'survivor',
    wizardType: 'survivor',
    name: 'Survivor',
    h1: 'Survivor Fantasy Leagues',
    title: 'Survivor Fantasy League – Tribes, Idols & Tribal Council | AllFantasy',
    description:
      'Start a free Survivor fantasy league. Tribes compete each week, the lowest-scoring tribe votes someone out, and hidden idols ride on drafted players.',
    intro:
      'Managers are split into tribes. The lowest-scoring tribe goes to Tribal Council and votes one of its own out. After the merge it is every manager for themselves.',
    forWho: 'For groups who like the strategy and the group chat as much as the points.',
    faqs: [
      {
        q: 'Do votes decide who goes, or scores?',
        a: 'Scores decide which tribe goes to Tribal Council. Then the managers on that tribe vote someone out.',
      },
      {
        q: 'How is this different from Survivor Guillotine?',
        a: 'Survivor has voting. In Survivor Guillotine nobody votes: the lowest scorer on a losing tribe is chopped automatically.',
      },
    ],
    related: ['survivor-guillotine', 'big-brother', 'guillotine'],
  },
  {
    slug: 'survivor-guillotine',
    demoId: 'survivor-guilly',
    wizardType: 'survivor_guillotine',
    name: 'Survivor Guillotine',
    h1: 'Survivor Guillotine Fantasy Leagues',
    title: 'Survivor Guillotine League – Tribes & Weekly Chops | AllFantasy',
    description:
      'Start a free Survivor Guillotine league. Tribes battle for immunity, the lowest scorer on a losing tribe is chopped automatically, down to a Final Three.',
    intro:
      'Survivor Guillotine (Survivor Guilly) mixes tribes and immunity with the guillotine’s weekly chop. Nobody votes: the scoreboard decides who goes.',
    forWho: 'For leagues that want Survivor’s tribes and twists without the politics of a vote.',
    faqs: [
      {
        q: 'Is there any voting?',
        a: 'No. The lowest-scoring manager on a tribe without immunity is chopped automatically.',
      },
    ],
    related: ['survivor', 'guillotine', 'zombie'],
  },
  {
    slug: 'zombie',
    demoId: 'zombie',
    wizardType: 'zombie',
    name: 'Zombie',
    h1: 'Zombie Fantasy Leagues',
    title: 'Zombie Fantasy League – Survivors, Zombies & a Whisperer | AllFantasy',
    description:
      'Start a free zombie league. One secret Whisperer, everyone else a Survivor. Lose to the Whisperer or a Zombie and you turn. Last Survivors standing win.',
    intro:
      'In a zombie league one manager is secretly the Whisperer and everyone else starts as a Survivor. Lose to the Whisperer or a Zombie and you turn into one.',
    forWho: 'For leagues that want a story that changes every week, not just a standings table.',
    faqs: [
      {
        q: 'Am I out of the league if I become a Zombie?',
        a: 'No. Zombies keep playing, and they can turn other Survivors. With enough serums a Zombie can come back to life.',
      },
    ],
    related: ['survivor', 'guillotine', 'big-brother'],
  },
  {
    slug: 'big-brother',
    demoId: 'big-brother',
    wizardType: 'big_brother',
    name: 'Big Brother',
    h1: 'Big Brother Fantasy Leagues',
    title: 'Big Brother Fantasy League – HOH, Veto & Evictions | AllFantasy',
    description:
      'Start a free Big Brother fantasy league. A weekly Head of Household nominates two managers, the Power of Veto can save one, and the house votes to evict.',
    intro:
      'A Big Brother league is a redraft league with a Big Brother house on top: a Head of Household each week, nominations, the Power of Veto, eviction votes and a jury.',
    forWho: 'For groups who want alliances, blindsides and a finale, alongside a normal fantasy season.',
    faqs: [
      {
        q: 'What happens to my team if I am evicted?',
        a: 'An evicted team stops scoring. Evicted managers form the jury that picks the winner at the finale.',
      },
    ],
    related: ['survivor', 'zombie', 'guillotine'],
  },
  {
    slug: 'devy',
    demoId: 'devy',
    wizardType: 'devy',
    name: 'Devy',
    h1: 'Devy Fantasy Leagues',
    title: 'Devy Fantasy League – Draft College Prospects | AllFantasy',
    description:
      'Start a free devy league: a dynasty league where you also draft college players, hold their rights, and promote them when they turn pro.',
    intro:
      'A devy league is a dynasty league with a second pool: college prospects. You draft them years early, hold their rights, and move them onto your roster when they go pro.',
    forWho: 'For dynasty managers who already follow college players and want credit for it.',
    faqs: [
      {
        q: 'How is devy different from Campus to Canton (C2C)?',
        a: 'In devy, college players are rights you hold and they do not score yet. In C2C your college players score every week in their own lineup.',
      },
    ],
    related: ['c2c', 'dynasty', 'idp'],
  },
  {
    slug: 'c2c',
    demoId: 'c2c',
    wizardType: 'c2c',
    name: 'Campus to Canton',
    h1: 'Campus to Canton (C2C) Fantasy Leagues',
    title: 'Campus to Canton (C2C) Fantasy League | AllFantasy',
    description:
      'Start a free Campus to Canton league. Set a college lineup and a pro lineup every week, and both count toward one combined score.',
    intro:
      'Campus to Canton (C2C) runs two lineups at once: a Campus lineup of college players and a Canton lineup of pros. Both score, and your players move up when they turn pro.',
    forWho: 'For managers who watch college games on Saturday and the pros on Sunday.',
    faqs: [
      {
        q: 'How is C2C different from devy?',
        a: 'In C2C your college players score every week. In devy they are prospects you hold until they turn pro.',
      },
    ],
    related: ['devy', 'dynasty', 'idp'],
  },
  {
    slug: 'idp',
    demoId: 'idp',
    wizardType: 'idp',
    name: 'IDP',
    h1: 'IDP Fantasy Football Leagues',
    title: 'IDP Fantasy Football Leagues – Start Real Defenders | AllFantasy',
    description:
      'Start a free IDP league. Replace the team defense with real linemen, linebackers and defensive backs. Tackles, sacks and interceptions all score.',
    intro:
      'IDP stands for individual defensive players. Instead of one team defense, you draft and start real defenders, so the whole field counts.',
    forWho: 'For managers who want defense to be a real decision, not the last pick of the draft.',
    faqs: [
      {
        q: 'Is IDP its own league type?',
        a: 'It is a setting you add to a league, so you can play IDP in a redraft league or a dynasty league.',
      },
    ],
    related: ['dynasty', 'devy', 'salary-cap'],
  },
  {
    slug: 'dynasty',
    demoId: 'dynasty',
    wizardType: 'dynasty',
    name: 'Dynasty',
    h1: 'Dynasty Fantasy Leagues',
    title: 'Dynasty Fantasy Leagues – Keep Your Roster Every Year | AllFantasy',
    description:
      'Start a free dynasty league. Your roster carries over every season, a rookie draft runs each offseason, and future draft picks can be traded.',
    intro:
      'In a dynasty league your roster never resets. You draft rookies every offseason, trade future picks, and build a team meant to win for years.',
    forWho: 'For managers who want fantasy to be a year-round, multi-season project.',
    faqs: [
      {
        q: 'How is dynasty different from keeper?',
        a: 'Dynasty keeps your whole roster every year. A keeper league keeps only a few players and drafts the rest again.',
      },
    ],
    related: ['keeper', 'devy', 'salary-cap'],
  },
  {
    slug: 'keeper',
    demoId: 'keeper',
    wizardType: 'keeper',
    name: 'Keeper',
    h1: 'Keeper Fantasy Leagues',
    title: 'Keeper Fantasy Leagues – Keep a Few, Draft the Rest | AllFantasy',
    description:
      'Start a free keeper league. Carry a few players into next season at the cost of a draft pick, and draft the rest of your team fresh.',
    intro:
      'A keeper league is a redraft league where every team carries a few players into next season. Each keeper costs you a draft pick, so every choice is a trade-off.',
    forWho: 'For leagues that want a fresh draft every year, but not a completely clean slate.',
    faqs: [
      {
        q: 'How is keeper different from dynasty?',
        a: 'A keeper league keeps only a few players and drafts the rest again. Dynasty keeps your whole roster every year.',
      },
    ],
    related: ['dynasty', 'salary-cap', 'best-ball'],
  },
  {
    slug: 'salary-cap',
    demoId: 'salary-cap',
    wizardType: 'salary_cap',
    name: 'Salary Cap',
    h1: 'Salary Cap Fantasy Leagues',
    title: 'Salary Cap Fantasy Leagues – Contracts & Cap Space | AllFantasy',
    description:
      'Start a free salary cap league. Every player has a salary and a contract, a startup auction builds the rosters, and every cut costs cap space.',
    intro:
      'In a salary cap league every player has a salary and a contract. You build your team in an auction, stay under a hard cap, and live with the deals you sign.',
    forWho: 'For managers who want to run their team like a front office, not just a roster.',
    faqs: [
      {
        q: 'Can I keep my best players?',
        a: 'Yes. Contracts carry over, and extensions and franchise tags let you keep your stars when a deal runs out.',
      },
    ],
    related: ['dynasty', 'keeper', 'best-ball'],
  },
  {
    slug: 'pirate',
    demoId: 'pirate',
    wizardType: 'pirate',
    name: 'Pirate',
    h1: 'Pirate Fantasy Leagues',
    title: 'Pirate Fantasy League – Win and Steal a Player | AllFantasy',
    description:
      'Start a free Pirate league. Protect a few players before kickoff, then win your matchup to steal an unprotected player from the team you beat.',
    intro:
      'A Pirate league is a head-to-head league where winning pays twice: you get the win, and you get to take one unprotected player from the team you beat.',
    forWho: 'For leagues that want every matchup to have something more than a win on the line.',
    faqs: [
      {
        q: 'Can I get a stolen player back?',
        a: 'The winner can offer a player back, and the losing manager can accept or counter.',
      },
    ],
    related: ['zombie', 'guillotine', 'survivor'],
  },
]

const BY_SLUG = new Map(LEAGUE_TYPE_PAGES.map((p) => [p.slug, p]))
const DEMO_BY_ID = new Map(FORMAT_DEMO_META.map((m) => [m.id, m]))

export const LEAGUE_TYPE_SLUGS: LeagueTypeSlug[] = LEAGUE_TYPE_PAGES.map((p) => p.slug)

export function getLeagueTypePage(slug: string): LeagueTypePage | null {
  return BY_SLUG.get(slug as LeagueTypeSlug) ?? null
}

/** The vetted pitch, rules and poster for a lander. Null only if the registry dropped the format. */
export function getLeagueTypeDemoMeta(page: LeagueTypePage): FormatDemoMeta | null {
  return DEMO_BY_ID.get(page.demoId) ?? null
}

export function getLeagueTypeCanonical(slug?: LeagueTypeSlug): string {
  return `${getPublicSiteOrigin()}/league-types${slug ? `/${slug}` : ''}`
}

/**
 * Sports a manager can actually CREATE this format in.
 *
 * ⚠ THE INTERSECTION IS DELIBERATE. The league-type registry and the create-league catalog seed
 * disagree for three formats (measured 2026-11-14): Guillotine is all seven sports in the
 * registry and NFL/NBA/NHL/MLB in the catalog; Devy adds NBA/NCAAB in the registry; C2C adds
 * NBA. The wizard reads the catalog when it has loaded and the registry otherwise, so only a
 * sport BOTH allow is one this page can promise without the create screen refusing it.
 */
export function getLeagueTypeSports(page: LeagueTypePage): LeagueSport[] {
  if (page.wizardType === 'idp') return [...IDP_SUPPORTED_SPORTS]
  const registry = new Set<string>(getAllowedSportsForLeagueType(page.wizardType as never))
  const seeded = LEAGUE_CREATE_OPTIONS_CATALOG_V1.allowedSportsByConcept?.[page.wizardType]
  const catalog = Array.isArray(seeded) && seeded.length > 0 ? new Set<string>(seeded) : registry
  return SUPPORTED_SPORTS.filter(
    (s) =>
      registry.has(s) &&
      catalog.has(s) &&
      (page.wizardType !== 'survivor' || isSurvivorCreationSportAvailable(s)),
  )
}

/** League types a manager can create in `sport` — the same rule as each lander's sports list. */
export function getLeagueTypesForSport(sport: string): LeagueTypePage[] {
  return LEAGUE_TYPE_PAGES.filter((p) => (getLeagueTypeSports(p) as string[]).includes(sport))
}

export const SPORT_DISPLAY: Record<LeagueSport, { label: string; lander: SportSlug }> = {
  NFL: { label: 'NFL', lander: 'fantasy-football' },
  NBA: { label: 'NBA', lander: 'fantasy-basketball' },
  MLB: { label: 'MLB', lander: 'fantasy-baseball' },
  NHL: { label: 'NHL', lander: 'fantasy-hockey' },
  NCAAF: { label: 'College football', lander: 'ncaa-football-fantasy' },
  NCAAB: { label: 'College basketball', lander: 'ncaa-basketball-fantasy' },
  SOCCER: { label: 'Soccer', lander: 'fantasy-soccer' },
}

export const LEAGUE_TYPES_HUB = {
  h1: 'Fantasy League Types',
  title: 'Fantasy League Types – Best Ball, Guillotine, Survivor & More | AllFantasy',
  description:
    'Every league type on AllFantasy, explained: best ball, guillotine, Survivor, zombie, Big Brother, devy, C2C, IDP, dynasty, keeper, salary cap and Pirate. All free.',
  intro:
    'Pick how your league plays. Each one below explains the rules, the sports it works in, and lets you look at a sample league before you start your own.',
}
