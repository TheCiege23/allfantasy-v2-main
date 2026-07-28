/**
 * Copy for the Nocturne marketing landing page (direction "1a").
 *
 * English only for this round — the design handoff is authored in en, and the
 * legacy multi-language `LANDING_COPY` in `../journey/copy.ts` stays with the
 * old scrollytelling page (kept as a rollback backup). Adding `es`/other locales
 * here is a clean follow-up: mirror this shape under a language key.
 *
 * Copy constraint (enforced by `__tests__/no-ai-customer-copy.test.ts`): no
 * customer-facing "AI" language — insights are "projected edge", "full output",
 * "insights", never "AI".
 */

export const NOCTURNE_COPY = {
  nav: {
    features: 'Features',
    howItWorks: 'How it works',
    forCommissioners: 'For commissioners',
    signIn: 'Sign in',
    getStarted: 'Get started free',
    ariaHome: 'AllFantasy home',
    ariaPrimaryNav: 'Primary',
    ariaFooterNav: 'Footer',
  },

  hero: {
    badge: 'Fantasy sports only · No gambling · Free for players',
    titleTop: 'Every league you play.',
    titleAccent: 'One screen.',
    body:
      'Bring Sleeper, ESPN, Yahoo and more into one command center that shows what needs your attention, who to start, and where to go — across every league at once.',
    primary: 'Get started free',
    secondary: 'See how it works',
    finePrint: 'Free to explore every league · Full insights from $14.99/mo · Cancel anytime',
    mockup: {
      title: 'Your leagues',
      clock: 'Week 12 · Sun 11:41a',
      rows: [
        { initial: 'S', color: '#1f2a4d', name: 'Dynasty Dragons', sub: 'Sleeper · Dynasty PPR', score: '96.2', opp: '–88.4', tag: 'Set flex', tagIcon: 'alert', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'Gridiron Gang', sub: 'ESPN · 0.5 PPR', score: '74.0', opp: '–91.6', tag: 'Waiver today', tagIcon: 'bell', tagKind: 'accent' },
        { initial: 'Y', color: '#3a1d55', name: 'Waiver Warriors', sub: 'Yahoo · Standard', score: '110.8', opp: '–102.1', tag: 'Trade', tagIcon: 'trade', tagKind: 'accent' },
        { initial: 'M', color: '#143a2e', name: 'End Zone Elites', sub: 'MFL · Keeper', score: '88.4', opp: '–71.9', tag: 'All set', tagIcon: 'check', tagKind: 'neutral' },
      ],
      lockedTitle: 'Projected edge this week',
      lockedSub: 'Across all 4 leagues',
      lockedValue: '+14.6',
      lockedTag: 'AF Legacy',
    },
  },

  stats: {
    items: [
      { value: '7', label: 'Sports covered' },
      { value: '13+', label: 'League formats' },
      { value: '5', label: 'Platforms imported' },
      { value: 'Live', label: 'Scoring & updates' },
    ],
    sports: ['NFL', 'NBA', 'NHL', 'MLB', 'NCAA', 'Soccer'],
  },

  features: {
    kicker: 'What you get',
    rows: [
      {
        index: '01',
        title: ['All your leagues,', 'one board.'],
        body:
          'Sleeper, ESPN, Yahoo, MFL and Fantrax — imported with your real rosters and history. Stop bouncing between apps; start your Sunday in one place.',
      },
      {
        index: '02',
        title: ['Know what needs', 'your attention.'],
        body:
          'Across every league at once: unset lineups, waiver runs happening today, trades waiting on you — each one tagged with which league and exactly what to do next.',
      },
      {
        index: '03',
        title: ['Every player,', 'every league.'],
        body:
          'Search any player and instantly see every team you have them on, with real stats, injuries and news pulled from live sports data — never a made-up number dressed up as fact.',
      },
    ],
  },

  howItWorks: {
    kicker: 'How it works',
    cards: [
      {
        icon: 'link',
        title: '1 · Connect your leagues',
        body:
          'Link Sleeper, ESPN, Yahoo, MFL or Fantrax in seconds. We pull in your real rosters, matchups and history — no manual setup.',
      },
      {
        icon: 'eye',
        title: '2 · See everything',
        body:
          'Every league lands on a single board. Your teams, your matchups, your players — side by side, finally.',
      },
      {
        icon: 'cursor',
        title: '3 · Know what to do',
        body:
          'AllFantasy reads all your leagues and points to what needs attention — the unset lineup, the waiver target, the trade worth making. You decide; it points the way.',
      },
    ],
  },

  commissioner: {
    kicker: 'For commissioners',
    titleTop: 'Run your league.',
    titleBottom: 'See all your others.',
    bodyLead: 'Commissioners do the most work and get the least help. Get the tools to run your league — invites, settings, matchups, standings, insights — while every ',
    bodyEm: 'other',
    bodyTail: ' league you play joins the same command center.',
    cta: 'Bring your league',
    cards: [
      { icon: 'shuffle', title: 'Dispersal draft', body: 'Managers leave? Pool their assets and run a live draft — automatically.' },
      { icon: 'shield', title: 'Integrity monitoring', body: 'Every trade gets a quiet fairness check. Opt-in anti-tanking keeps it real.' },
      { icon: 'dice', title: 'Weighted lottery', body: 'NBA-style draft order for dynasty. Kills tanking without killing the fun.' },
      { icon: 'broadcast', title: 'League broadcast', body: 'Send announcements, polls and events to all your leagues at once.' },
    ],
  },

  pricing: {
    kicker: 'Simple pricing',
    title: 'Free to see it all. Upgrade to act on it.',
    body:
      'Explore every league, live scores and standings for free. Go Commissioner for the tools to run your league, or AF Legacy for the full analytical edge — projected edges, trade fairness and waiver targets.',
    plans: {
      free: {
        name: 'Free',
        price: '$0',
        priceSuffix: 'forever, for players',
        features: [
          { text: 'All your leagues on one board', locked: false },
          { text: 'Live scores, matchups & standings', locked: false },
          { text: 'Player search across every league', locked: false },
          { text: 'Projected edges & full insights', locked: true },
        ],
        cta: 'Get started free',
      },
      commissioner: {
        name: 'Commissioner',
        price: '$14.99',
        priceSuffix: '/ mo',
        priceYear: 'or $149.99/yr',
        features: [
          'Everything in Free',
          'Full commissioner tool suite',
          'Dispersal draft & weighted lottery',
          'Integrity monitoring & broadcast',
        ],
        cta: 'Get Commissioner',
      },
      legacy: {
        name: 'AF Legacy',
        price: '$29.99',
        priceSuffix: '/ mo',
        priceYear: 'or $299.99/yr',
        badge: 'Full output',
        features: [
          'Everything in Free',
          'Projected edge & start/sit calls',
          'Trade fairness & waiver targets',
          'Full output across every league',
        ],
        cta: 'Get AF Legacy',
      },
    },
  },

  finalCta: {
    title: 'Your whole fantasy life, in one place.',
    body:
      'Early access is rolling out to managers and commissioners now. Free to start — no gambling, no DFS, just the clearest view of every league you play.',
    primary: 'Get started free',
    secondary: 'Start a league',
  },

  importFlow: {
    kicker: 'Connect your league to AllFantasy',
    title: 'Connect your league in seconds.',
    // Honest framing: connecting builds a READ-ONLY analytical copy of your
    // league after you create a free account. AllFantasy never changes anything
    // on the external platform, and there is no anonymous connection.
    body: 'Pick your platform and drop in your Sleeper username or league ID. Create a free account and we build a read-only copy of your real teams, matchups, and scoring — AllFantasy analyzes your league but never changes anything on the external platform.',
    submitFull: 'Connect my league',
    submitMini: 'Connect',
    miniLabel: 'Connect your league',
    importing: 'Taking you to connect your league…',
    teaserCaption: 'Your real leagues appear here',
    // {label} interpolated in the component.
    trustNote: 'Create a free account to connect your {label} league — read-only, no password, ever.',
    nonSleeperNote: 'Create a free account to finish connecting {label} — no password, ever.',
  },

  footer: {
    copyright: '© 2026 AllFantasy.ai',
    privacy: 'Privacy',
    terms: 'Terms',
    dataDeletion: 'Data deletion',
    signIn: 'Sign in',
    geoNote:
      'Not available in WA. Paid leagues restricted in HI, ID, MT, NV. AllFantasy is 100% fantasy sports — no gambling, no sportsbook.',
  },
} as const

export type NocturneCopy = typeof NOCTURNE_COPY
