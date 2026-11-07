/**
 * Copy for /commissioners — the Commissioner OS page.
 *
 * Kept apart from the component so wording can change without touching layout.
 *
 * ⚠ RULES THIS COPY FOLLOWS, AND ANY EDIT SHOULD KEEP:
 *  - Customer-facing product names only: Commissioner OS, Decision OS, Chimmy Intelligence, Coach,
 *    Assist. No "AI-powered" framing.
 *  - AllFantasy does not hold or move league money. Nothing here may read as processing dues or
 *    payouts, and nothing may sound like betting.
 *  - The "coming soon" row is a roadmap, not a feature list. Every card carries a visible badge and
 *    none is linked to a page that would imply it works today.
 *  - Platform names are NEVER typed here. They are read from `lib/league-import/provider-ui-config.ts`
 *    at render time, so the page cannot call Yahoo importable while it is coming soon.
 */

export type CommissionerFeature = {
  /** Anchor id, also the heading id the section is labelled by. */
  id: string
  eyebrow: string
  title: string
  body: string
  points: readonly string[]
  /** Public path of the real screenshot. A styled placeholder renders until the file exists. */
  image: string
  imageAlt: string
}

export const COMMISSIONERS_META = {
  title: 'Commissioner OS — Built by a commissioner, for commissioners | AllFantasy',
  description:
    'Know when your league needs attention before problems become obvious. League Health, illegal lineup alerts, a trade evaluator that knows your league type, and integrity reports — free to import.',
  ogTitle: 'Built by a commissioner, for commissioners.',
  ogDescription:
    'Commissioner OS tells you when your league needs attention before problems become obvious. Import your league free.',
} as const

export const COMMISSIONERS_HERO = {
  eyebrow: 'Commissioner OS',
  h1a: 'Built by a commissioner,',
  h1b: 'for commissioners.',
  sub: 'Know when your league needs attention before problems become obvious.',
  founder:
    'AllFantasy is run by a commish of 28 leagues. He built it because running leagues was taking over his week.',
  ctaPrimary: 'Import your league free',
  ctaSecondary: 'See pricing',
  reassure: 'Free to import · Read-only — we never change your league · AllFantasy never holds league dues',
} as const

/** The illustrative health card beside the hero. Labelled "example" on the page. */
export const COMMISSIONERS_HEALTH_EXAMPLE = {
  title: 'League Health',
  week: 'Example · Week 9',
  score: 62,
  verdict: 'At risk — 3 things need you this week',
  alerts: [
    { tone: 'bad', tag: 'Lineup', text: 'One team has started an empty slot for 2 weeks' },
    { tone: 'warn', tag: 'Trade', text: 'A trade was flagged as lopsided — review before it processes' },
    { tone: 'warn', tag: 'Activity', text: '3 managers have not checked in for 21 days' },
  ],
} as const

export const COMMISSIONER_FEATURES: readonly CommissionerFeature[] = [
  {
    id: 'league-health',
    eyebrow: '01 · League Health Meter',
    title: 'See trouble before your league folds.',
    body: 'The League Health Meter warns you when your league is at risk of not making it to next season — while there is still time to do something about it.',
    points: [
      'Tracks activity and engagement week over week',
      'Flags the managers and teams dragging the league down',
      'Tells you which issue to fix first',
    ],
    image: '/images/commissioners/league-health.png',
    imageAlt: 'The League Health Meter showing a league score and the issues behind it',
  },
  {
    id: 'illegal-lineups',
    eyebrow: '02 · Illegal Lineup Alerts',
    title: 'Illegal lineups, caught early.',
    body: 'When a lineup goes illegal, the manager and the commish both get notified, including how long it has been illegal — so it gets fixed before it costs anyone a game.',
    points: [
      'Notifies the manager and the commish',
      'Shows how long the lineup has been illegal',
      'Catches empty slots, byes and injured starters',
    ],
    image: '/images/commissioners/illegal-lineups.png',
    imageAlt: 'An illegal lineup alert naming the team, the empty slot and how long it has been illegal',
  },
  {
    id: 'trade-evaluator',
    eyebrow: '03 · Trade Evaluator',
    title: 'Trade grades that know your league.',
    body: 'Trades are evaluated on how your league actually works, not a generic value chart, and the evaluation is emailed to league members.',
    points: [
      'League type: redraft, dynasty, Guillotine, C2C and more',
      'Your scoring and roster setup',
      'Roster need, and whether each team is contending or rebuilding',
    ],
    image: '/images/commissioners/trade-evaluator.png',
    imageAlt: 'A trade evaluation showing the grade for each side and the reasons behind it',
  },
  {
    id: 'integrity',
    eyebrow: '04 · Anti-Collusion & Anti-Tanking',
    title: 'Integrity reports you can share.',
    body: 'Lopsided trades and suspicious lineup behavior get flagged, and you get a report you can share with the league — the evidence, not an accusation.',
    points: [
      'Flags lopsided trades with the reasoning',
      'Spots suspicious lineup patterns over time',
      'A shareable report for the whole league',
    ],
    image: '/images/commissioners/integrity-report.png',
    imageAlt: 'An integrity report listing a flagged trade and a lineup pattern with supporting detail',
  },
  {
    id: 'league-hub',
    eyebrow: '05 · League Import & League Hub',
    title: 'Every league you run, in one place.',
    // `{platforms}` is filled from the import config at render time.
    body: 'Bring in your leagues from {platforms} and run them from one League Hub instead of five apps.',
    points: [
      'One dashboard across every league you run',
      'Read-only — AllFantasy never changes your league on the host platform',
      'Import free, no card needed',
    ],
    image: '/images/commissioners/league-hub.png',
    imageAlt: 'The League Hub listing leagues imported from several platforms',
  },
] as const

export const COMMISSIONERS_ROADMAP = {
  h2: 'On the roadmap',
  badge: 'Coming soon',
  note: 'Not live yet. We will say so here when each one ships.',
  items: [
    { title: 'Keepers on the draft board', body: 'Keepers placed in the right round on the draft board automatically.' },
    { title: 'Trade evals in league chat', body: 'Evaluations posted to league chat, where the league already talks.' },
    { title: 'Draft scheduler', body: 'Find a draft time that works for everyone in the league.' },
    { title: 'Rule-change voting', body: 'Propose a rule change and let the league vote on it.' },
    { title: 'Dues tracker', body: 'Track who has paid. AllFantasy never holds or moves the money.' },
  ],
} as const

export const COMMISSIONERS_HOW = {
  h2: 'How it works',
  steps: [
    { n: '01', title: 'Import', body: 'Connect your league from {platforms}. Read-only, and free.' },
    { n: '02', title: "See your league's health", body: 'Get a health reading and the specific issues behind it.' },
    { n: '03', title: 'Fix issues before they blow up', body: 'Act on lineups, lopsided trades and inactive managers while it is still easy.' },
  ],
} as const

export const COMMISSIONERS_BOTTOM = {
  h2: "See your league's health in minutes.",
  body: 'Import is free, read-only, and needs no card.',
} as const

export const COMMISSIONERS_PLATFORMS = {
  label: 'Imports from',
  soon: 'Coming soon',
} as const
