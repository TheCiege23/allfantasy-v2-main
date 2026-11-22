/**
 * Which blog guides each SEO lander links to.
 *
 * The blog posts were reachable only from /blog and the sitemap: no lander, and nothing on the
 * homepage, linked to them. A guide linked from the page about its own format is the cheapest
 * internal link there is, and it is the page a reader of that lander wants next.
 *
 * 🛑 LIST A POST ONLY ONCE IT IS LIVE. These landers are statically generated, so a link to a draft
 * or a post scheduled for later is a link to a 404 until it publishes. A scheduled post joins this
 * list in a commit made on or after its publish date.
 *
 * Titles are the posts' own titles, copied so the lander renders without a database read.
 */

import type { LeagueTypeSlug } from './league-type-pages'
import type { SportSlug } from './config'

export type BlogGuideLink = { slug: string; title: string }

const GUILLOTINE: BlogGuideLink = {
  slug: 'guillotine-league-strategy',
  title: 'How to Survive a Guillotine League, Week by Week',
}
const TRADE_DEADLINE: BlogGuideLink = {
  slug: 'fantasy-football-trade-deadline-strategy',
  title: 'How to Win Your Fantasy Football Trade Deadline',
}
const POINTS_VS_CATEGORIES: BlogGuideLink = {
  slug: 'fantasy-basketball-points-vs-categories',
  title: 'Points or Categories? How to Pick a Fantasy Basketball Format',
}
const CFP_POOL: BlogGuideLink = {
  slug: 'college-football-playoff-bracket-pool',
  title: 'How to Win Your College Football Playoff Bracket Pool',
}
const NBA_CUP_POOL: BlogGuideLink = {
  slug: 'nba-cup-pool-guide',
  title: 'How to Win Your NBA Cup Pool',
}
const HOCKEY: BlogGuideLink = {
  slug: 'fantasy-hockey-strategy',
  title: 'How to Win at Fantasy Hockey: Points, Categories and Goalies',
}
const DYNASTY: BlogGuideLink = {
  slug: 'dynasty-fantasy-football-guide',
  title: "How Dynasty Fantasy Football Works: A Beginner's Guide",
}
const SOCCER: BlogGuideLink = {
  slug: 'fantasy-soccer-strategy',
  title: 'Fantasy Soccer Strategy: How Scoring Works and Who to Start',
}
const DEVY: BlogGuideLink = {
  slug: 'devy-fantasy-football',
  title: 'What Is a Devy League? How Devy Fantasy Football Works',
}
const KEEPER: BlogGuideLink = {
  slug: 'keeper-league-guide',
  title: 'How Keeper Leagues Work: Who to Keep and What It Costs',
}
const BEST_BALL: BlogGuideLink = {
  slug: 'best-ball-fantasy-football',
  title: 'What Is Best Ball? How Best Ball Fantasy Football Works',
}
const SALARY_CAP: BlogGuideLink = {
  slug: 'salary-cap-fantasy-football',
  title: 'How Salary Cap Fantasy Football Works: Contracts, Cap Space and Dead Money',
}
const IDP: BlogGuideLink = {
  slug: 'idp-fantasy-football',
  title: 'IDP Fantasy Football: How Individual Defensive Players Work',
}
const C2C: BlogGuideLink = {
  slug: 'campus-to-canton-fantasy-football',
  title: 'Campus to Canton (C2C) Fantasy Football: How It Works',
}
const SURVIVOR: BlogGuideLink = {
  slug: 'survivor-fantasy-league',
  title: 'How Survivor Fantasy Leagues Work: Tribes, Idols and Tribal Council',
}
const ZOMBIE: BlogGuideLink = {
  slug: 'zombie-fantasy-league',
  title: 'How Zombie Fantasy Leagues Work: Survivors, Zombies and the Whisperer',
}
const BIG_BROTHER: BlogGuideLink = {
  slug: 'big-brother-fantasy-league',
  title: 'How Big Brother Fantasy Leagues Work: HOH, Veto and Evictions',
}
const FAAB: BlogGuideLink = {
  slug: 'faab-fantasy-football',
  title: 'How FAAB Works: Fantasy Football Waiver Bidding Explained',
}
const START_A_LEAGUE: BlogGuideLink = {
  slug: 'how-to-start-a-fantasy-football-league',
  title: "How to Start a Fantasy Football League: A Commissioner's Checklist",
}
const NBA_STREAMING: BlogGuideLink = {
  slug: 'fantasy-basketball-streaming',
  title: 'Fantasy Basketball Streaming: How to Win the Waiver Wire',
}
const IMPORT_A_LEAGUE: BlogGuideLink = {
  slug: 'import-fantasy-league',
  title: 'How to Import Your Fantasy League: Sleeper, ESPN, Fantrax and More',
}

/** Guides for /league-types/<slug>, the format's own guide first. */
export const LEAGUE_TYPE_GUIDES: Partial<Record<LeagueTypeSlug, readonly BlogGuideLink[]>> = {
  guillotine: [GUILLOTINE, SURVIVOR],
  survivor: [SURVIVOR, GUILLOTINE],
  // The Survivor guide covers this variant in its own section; the guillotine guide covers the chop.
  'survivor-guillotine': [SURVIVOR, GUILLOTINE],
  dynasty: [DYNASTY, TRADE_DEADLINE],
  devy: [DEVY, C2C, DYNASTY],
  keeper: [KEEPER, DYNASTY],
  'best-ball': [BEST_BALL],
  'salary-cap': [SALARY_CAP, DYNASTY],
  idp: [IDP, DYNASTY],
  c2c: [C2C, DEVY],
  zombie: [ZOMBIE, SURVIVOR, GUILLOTINE],
  'big-brother': [BIG_BROTHER, SURVIVOR, ZOMBIE],
}

/** Guides for /sports/<slug>. */
export const SPORT_GUIDES: Partial<Record<SportSlug, readonly BlogGuideLink[]>> = {
  // The checklist leads: this page is where someone deciding to start a league lands. The import
  // guide follows it for the reader who already plays somewhere else.
  'fantasy-football': [START_A_LEAGUE, IMPORT_A_LEAGUE, DYNASTY, KEEPER, BEST_BALL, SALARY_CAP, IDP, FAAB, TRADE_DEADLINE, GUILLOTINE],
  'fantasy-basketball': [POINTS_VS_CATEGORIES, NBA_STREAMING, NBA_CUP_POOL],
  'fantasy-hockey': [HOCKEY],
  'fantasy-soccer': [SOCCER],
  'ncaa-football-fantasy': [DEVY, C2C, CFP_POOL],
}

export function blogGuideHref(slug: string): string {
  return `/blog/${slug}`
}
