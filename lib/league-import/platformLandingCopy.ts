/**
 * Public, indexable copy for the per-platform import landing pages.
 *
 * ⚠ THE FLOW ITSELF CAN NEVER BE INDEXED. `/import` redirects to `/login`, so no
 * crawler has ever seen it and no amount of metadata on that page will change
 * that. These pages are the searchable surface: one public URL per platform that
 * answers "how do I import my <platform> league", carries the read-only trust
 * contract, and hands the visitor into the gated flow.
 *
 * ⚠ EVERY CLAIM HERE IS GROUNDED IN WHAT THE PRODUCT ACTUALLY DOES. The
 * `needs` line for each platform is the same fact its field help states inside
 * ImportV4, and availability is read from provider-ui-config at render time
 * rather than restated here — marketing copy that outruns the product is how a
 * landing page becomes a promise the funnel breaks.
 */

import type { ImportProvider } from './types'

export type PlatformLanding = {
  provider: ImportProvider
  /** The URL segment. Kept separate from the provider id so a slug can differ. */
  slug: string
  /** Brand name as people search for it — not necessarily the config label. */
  name: string
  /*
   * ⚠ "a" IS WRONG FOR ESPN. The heading is composed as "How importing {article}
   * {name} league works", and hardcoding "a" produced "a ESPN league" on a page
   * whose entire job is to rank for that phrase. The article follows the SOUND,
   * not the spelling — ESPN reads "ee-ESPN" — so it is stated per platform rather
   * than guessed from the first letter.
   */
  article: 'a' | 'an'
  /** <title>. Front-loaded with the platform, because that is the query. */
  title: string
  /** <meta name="description">. One sentence, under ~155 chars. */
  description: string
  /** The <h1>. Distinct from `title` on purpose: one reads as a page, one as a headline. */
  heading: string
  /** The paragraph under the h1. */
  intro: string
  /** What the visitor needs before starting — the honest prerequisite. */
  needs: string
  /** Ordered, concrete steps. Becomes both visible copy and HowTo structured data. */
  steps: readonly string[]
  /** Questions people actually ask. Becomes visible copy and FAQPage data. */
  faq: readonly { q: string; a: string }[]
}

/** Shared trust content — identical on every page because the promise is identical. */
export const WHAT_WE_READ = 'Teams, rosters, matchups, scoring settings and past seasons.'
export const WHAT_WE_NEVER_DO =
  'Set your lineup, make trades, post in your league chat, or ask for your platform password.'

const LANDINGS: readonly PlatformLanding[] = [
  {
    provider: 'sleeper',
    article: 'a',
    slug: 'sleeper',
    name: 'Sleeper',
    title: 'Import your Sleeper league to AllFantasy — free, read-only',
    description:
      'Connect a Sleeper league to AllFantasy with just your username. We build a read-only copy of your teams, matchups and scoring. No password, ever.',
    heading: 'Import your Sleeper league in seconds',
    intro:
      'Drop in your Sleeper username and AllFantasy finds every league on the account. We build a read-only copy of your real teams, rosters, matchups and scoring settings — and never change anything on Sleeper.',
    needs: 'Your Sleeper username. No password and no app install.',
    steps: [
      'Enter your Sleeper username — the handle your leaguemates see, not an email.',
      'AllFantasy looks up every NFL league on that account and lists them.',
      'Pick the leagues you want, or import them all at once.',
      'Your read-only copy is built: rosters, matchups, scoring settings and past seasons.',
    ],
    faq: [
      {
        q: 'Do I need my Sleeper password?',
        a: 'No. Sleeper publishes league data against a username, so AllFantasy never asks for a password and could not use one if you offered it.',
      },
      {
        q: 'Can AllFantasy change my Sleeper lineup?',
        a: 'No. The connection is read-only in both directions — Sleeper has no write endpoint for third parties, and AllFantasy never sets lineups, makes trades or posts in chat.',
      },
      {
        q: 'How many Sleeper leagues can I import?',
        a: 'All of them. Accounts with fifty or more leagues import in one pass, and you choose which ones to keep.',
      },
    ],
  },
  {
    provider: 'espn',
    article: 'an',
    slug: 'espn',
    name: 'ESPN',
    title: 'Import your ESPN fantasy league to AllFantasy — read-only',
    description:
      'Connect an ESPN fantasy football league to AllFantasy. One-click with the browser extension, or paste two cookies. Read-only, stored encrypted, no password.',
    heading: 'Import your ESPN league',
    intro:
      'ESPN gives no public way to read a league, so AllFantasy reads it as you — using your own browser session, stored encrypted. We never ask for your ESPN password.',
    needs:
      'A connected ESPN session, via the AllFantasy browser extension or two cookies you paste once. This is needed for every ESPN league, public ones included.',
    steps: [
      'Choose ESPN on the connect screen.',
      'Connect once — one click with the AllFantasy extension, or paste your SWID and espn_s2 cookie values.',
      'Paste the league ID from your ESPN league URL.',
      'Your read-only copy is built: rosters, matchups, scoring settings and past seasons.',
    ],
    faq: [
      {
        q: 'Why does ESPN need cookies when Sleeper does not?',
        a: 'ESPN has no public league API and no third-party sign-in. The only way to read your league is as you, which is what the cookies allow. They are stored encrypted and used for nothing else.',
      },
      {
        q: 'Do I need the extension?',
        a: 'No — it just saves you a trip to your browser dev tools. Pasting the two cookie values by hand does exactly the same thing.',
      },
      {
        q: 'Does this work on a phone?',
        a: 'Connect ESPN once on a desktop browser; it stays connected on your account afterwards. Browser extensions do not run on most mobile browsers.',
      },
    ],
  },
  {
    provider: 'yahoo',
    article: 'a',
    slug: 'yahoo',
    name: 'Yahoo',
    title: 'Import your Yahoo fantasy league to AllFantasy — read-only',
    description:
      'Connect a Yahoo fantasy football league to AllFantasy with Yahoo sign-in. Approve read-only access and we list every league on the account.',
    heading: 'Import your Yahoo league',
    intro:
      'Yahoo connects with its own sign-in, so there is no username to type and no password for AllFantasy to see. Approve read-only access and every league on the account is listed.',
    needs: 'A Yahoo account, and one approval of read-only fantasy access.',
    steps: [
      'Choose Yahoo on the connect screen and press Connect Yahoo.',
      'Approve read-only access on Yahoo. AllFantasy never sees your password.',
      'Every NFL league on the account is listed — pick the ones you want.',
      'Your read-only copy is built: rosters, matchups, scoring settings and past seasons.',
    ],
    faq: [
      {
        q: 'What is AllFantasy allowed to do on Yahoo?',
        a: 'Read your leagues, and nothing else. The approval is read-only and AllFantasy never sets lineups, makes trades or posts in chat.',
      },
      {
        q: 'Yahoo signed me in but listed no leagues. Why?',
        a: 'Either the approval did not include fantasy read access, or the leagues sit on a different Yahoo account. Reconnecting and approving read access resolves both.',
      },
      {
        q: 'Can I import one Yahoo league by ID instead?',
        a: 'Yes. If the account-wide list is refused you can paste a single league ID and AllFantasy will ask Yahoo for just that league.',
      },
    ],
  },
  {
    provider: 'fleaflicker',
    article: 'a',
    slug: 'fleaflicker',
    name: 'Fleaflicker',
    title: 'Import your Fleaflicker league to AllFantasy — read-only',
    description:
      'Connect a Fleaflicker league to AllFantasy with just the league ID. Nothing to install, no account to link, no password.',
    heading: 'Import your Fleaflicker league',
    intro:
      'Fleaflicker publishes league data openly, which makes it the simplest connection AllFantasy offers: paste the number from your league URL and nothing else.',
    needs: 'The league ID from your Fleaflicker URL. Nothing to connect first.',
    steps: [
      'Open your league on Fleaflicker and copy the number from the address — fleaflicker.com/nfl/leagues/THIS-PART.',
      'Choose Fleaflicker on the connect screen and paste it in.',
      'AllFantasy reads the league and shows you what it found.',
      'Your read-only copy is built: rosters, matchups, scoring settings and past seasons.',
    ],
    faq: [
      {
        q: 'Do I need a Fleaflicker account linked?',
        a: 'No. Fleaflicker publishes league data, so AllFantasy reads it without an account, a cookie or a key.',
      },
      {
        q: 'Where do I find the league ID?',
        a: 'It is the number in your league URL, between /leagues/ and the next slash. You can paste the whole link instead if that is easier.',
      },
    ],
  },
  {
    provider: 'mfl',
    article: 'a',
    slug: 'myfantasyleague',
    name: 'MyFantasyLeague (MFL)',
    title: 'Import your MyFantasyLeague (MFL) league to AllFantasy',
    description:
      'Connect an MFL league to AllFantasy with your league ID and an MFL API key. Read-only, key stored encrypted, never your password.',
    heading: 'Import your MyFantasyLeague league',
    intro:
      'MFL reads through its export API, which takes a key on every call. Save the key once and AllFantasy can build a read-only copy of any league on your account.',
    needs:
      'Your league ID and an MFL API key. The key is required for every league, public ones included — it is not your password.',
    steps: [
      'Save your MFL API key once under Settings → Connected Accounts.',
      'Choose MFL on the connect screen and paste your league ID.',
      'AllFantasy reads the league through MFL’s export API.',
      'Your read-only copy is built: rosters, matchups, scoring settings and past seasons.',
    ],
    faq: [
      {
        q: 'Is the API key the same as my MFL password?',
        a: 'No. It is a separate credential you generate in MFL, it only permits reads, and AllFantasy stores it encrypted.',
      },
      {
        q: 'My league is public — do I still need a key?',
        a: 'Yes. MFL’s export API takes a key on every call this integration makes, so there is no public-league shortcut.',
      },
    ],
  },
  {
    provider: 'fantrax',
    article: 'a',
    slug: 'fantrax',
    name: 'Fantrax',
    title: 'Import your Fantrax league to AllFantasy — read-only',
    description:
      'Connect a Fantrax league to AllFantasy with the league ID from your URL, then pick your team. Read-only, and never your Fantrax password.',
    heading: 'Import your Fantrax league',
    intro:
      'Fantrax reads from the league ID in your URL. AllFantasy shows you the teams in that league so you can point at yours — no password and no Secret ID required.',
    needs:
      'The league ID from your Fantrax URL. Optionally a Secret ID, which lets AllFantasy name your leagues and your team without you typing either.',
    steps: [
      'Copy the code from your league URL — fantrax.com/fantasy/league/THIS-PART/home.',
      'Choose Fantrax on the connect screen and paste it in.',
      'Pick which team in that league is yours.',
      'Your read-only copy is built: rosters, matchups, scoring settings and past seasons.',
    ],
    faq: [
      {
        q: 'Do I have to give AllFantasy my Fantrax Secret ID?',
        a: 'No. A league ID is public and is all the import needs. The Secret ID is optional and only saves you the step of picking your team.',
      },
      {
        q: 'Can I import past seasons from a Fantrax export?',
        a: 'Yes. A CSV export carries seasons the live API does not expose, and AllFantasy accepts one alongside the league-ID import.',
      },
    ],
  },
]

export const PLATFORM_LANDINGS = LANDINGS

export function getPlatformLanding(slug: string): PlatformLanding | null {
  const wanted = slug.trim().toLowerCase()
  return LANDINGS.find((l) => l.slug === wanted) ?? null
}

export function platformLandingSlugs(): string[] {
  return LANDINGS.map((l) => l.slug)
}
