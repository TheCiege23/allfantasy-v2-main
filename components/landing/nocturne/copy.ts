/**
 * Copy for the Nocturne marketing landing page (direction "1a").
 *
 * This file is the ENGLISH source of truth and the canonical shape. Other locales
 * live in `./copy.i18n.ts`, each conforming to the `NocturneCopy` interface below,
 * and `getNocturneCopy(lang)` (also there) picks the active one — wired to the
 * app-wide language selector via `useOptionalLanguage()` in the components.
 *
 * Copy constraint: no customer-facing "AI" language — insights are "projected
 * edge", "full output", "insights", never "AI".
 */

/** One feature bullet in a pricing tier. `locked` renders a lock icon instead of a check. */
export interface NocturnePlanFeature {
  text: string
  locked?: boolean
}

/** One pricing tier card. `plan` is the /upgrade?plan= key (null → straight to signup). */
export interface NocturnePlanTier {
  key: string
  name: string
  price: string
  priceSuffix: string
  priceYear: string | null
  plan: string | null
  featured: boolean
  badge: string | null
  cta: string
  features: NocturnePlanFeature[]
}

/** One league row in the hero dashboard mockup (illustrative sample data). */
export interface NocturneMockRow {
  initial: string
  color: string
  name: string
  sub: string
  score: string
  opp: string
  tag: string
  tagIcon: string
  tagKind: string
}

/** Full shape of the landing copy. Every locale in copy.i18n.ts implements this. */
export interface NocturneCopy {
  nav: {
    features: string
    howItWorks: string
    forCommissioners: string
    signIn: string
    getStarted: string
    getStartedShort: string
    ariaHome: string
    ariaPrimaryNav: string
    ariaFooterNav: string
  }
  hero: {
    badge: string
    titleTop: string
    titleAccent: string
    body: string
    primary: string
    secondary: string
    finePrint: string
    mockup: {
      title: string
      clock: string
      rows: NocturneMockRow[]
      lockedTitle: string
      lockedSub: string
      lockedValue: string
      lockedTag: string
    }
  }
  stats: {
    items: { value: string; label: string }[]
    sports: string[]
  }
  features: {
    kicker: string
    rows: { index: string; title: string[]; body: string }[]
  }
  howItWorks: {
    kicker: string
    cards: { icon: string; title: string; body: string }[]
  }
  commissioner: {
    kicker: string
    titleTop: string
    titleBottom: string
    bodyLead: string
    bodyEm: string
    bodyTail: string
    cta: string
    cards: { icon: string; title: string; body: string }[]
  }
  pricing: {
    kicker: string
    title: string
    body: string
    footnote: string
    tiers: NocturnePlanTier[]
  }
  finalCta: {
    title: string
    body: string
    primary: string
    secondary: string
  }
  importFlow: {
    kicker: string
    title: string
    body: string
    submitFull: string
    submitMini: string
    miniLabel: string
    importing: string
    teaserCaption: string
    trustNote: string
    nonSleeperNote: string
    /** Shown on the trust line when the selected provider isn't live. `{label}` interpolated. */
    comingSoonNote: string
    /** Chip / <option> suffix for a not-yet-available platform. */
    platformSoon: string
  }
  footer: {
    copyright: string
    privacy: string
    terms: string
    dataDeletion: string
    signIn: string
    geoNote: string
  }
}

export const NOCTURNE_COPY: NocturneCopy = {
  nav: {
    features: 'Features',
    howItWorks: 'How it works',
    forCommissioners: 'For commissioners',
    signIn: 'Sign in',
    getStarted: 'Get started free',
    // Shorter label swapped in on very narrow phones so "Sign in" + the primary
    // CTA both stay visible in the nav (see n-cta-full / n-cta-short in nocturne.css).
    getStartedShort: 'Get started',
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
    finePrint: 'Free to explore every league · Paid plans from $9.99/mo · Cancel anytime',
    mockup: {
      title: 'Your leagues',
      clock: 'Week 12 · Sun 11:41a',
      rows: [
        { initial: 'S', color: '#1f2a4d', name: 'Dynasty Dragons', sub: 'Sleeper · Dynasty PPR', score: '96.2', opp: '–88.4', tag: 'Set flex', tagIcon: 'alert', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'Gridiron Gang', sub: 'ESPN · 0.5 PPR', score: '74.0', opp: '–91.6', tag: 'Waiver today', tagIcon: 'bell', tagKind: 'accent' },
        { initial: 'Y', color: '#3a1d55', name: 'Waiver Warriors', sub: 'Yahoo · Standard', score: '110.8', opp: '–102.1', tag: 'Trade', tagIcon: 'trade', tagKind: 'accent' },
        { initial: 'E', color: '#4a1414', name: 'End Zone Elites', sub: 'ESPN · Keeper', score: '88.4', opp: '–71.9', tag: 'All set', tagIcon: 'check', tagKind: 'neutral' },
      ],
      lockedTitle: 'Projected edge this week',
      lockedSub: 'Across all 4 leagues',
      lockedValue: '+14.6',
      lockedTag: 'AF Legacy',
    },
  },

  stats: {
    items: [
      { value: '6', label: 'Sports covered' },
      { value: '13+', label: 'League formats' },
      { value: '3', label: 'Platforms live' },
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
          'Sleeper, ESPN and Yahoo — imported with your real rosters and history, with MFL and Fantrax coming soon. Stop bouncing between apps; start your Sunday in one place.',
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
          'Link Sleeper, ESPN or Yahoo in seconds — MFL and Fantrax are coming soon. We pull in your real rosters, matchups and history — no manual setup.',
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
      'Explore every league, live scores and standings for free. Go Pro for player tools, Commissioner to run your leagues, Supreme for projections and cross-league analytics, or AF Legacy for the full output — live draft room, dynasty tools and priority access.',
    footnote:
      'Every paid plan includes a monthly token allowance and can be billed monthly or yearly. Cancel anytime.',
    // Ordered low→high. Prices, names, and the "Everything in …" ladder mirror the
    // canonical catalog (lib/monetization/catalog.ts); `plan` maps to the /upgrade
    // ?plan= param normalized in app/upgrade/page.tsx. `plan: null` → straight to signup.
    tiers: [
      {
        key: 'free',
        name: 'Free',
        price: '$0',
        priceSuffix: 'forever, for players',
        priceYear: null,
        plan: null,
        featured: false,
        badge: null,
        cta: 'Get started free',
        features: [
          { text: 'All your leagues on one board' },
          { text: 'Live scores, matchups & standings' },
          { text: 'Player search across every league' },
          { text: 'Projected edges & full insights', locked: true },
        ],
      },
      {
        key: 'pro',
        name: 'AF Pro',
        price: '$9.99',
        priceSuffix: '/ mo',
        priceYear: 'or $99.99/yr',
        plan: 'pro',
        featured: false,
        badge: null,
        cta: 'Get AF Pro',
        features: [
          { text: 'Everything in Free' },
          { text: 'Trade & waiver tools' },
          { text: 'Start/sit & lineup guidance' },
          { text: 'Draft prep & mock drafts' },
        ],
      },
      {
        key: 'commissioner',
        name: 'Commissioner',
        price: '$14.99',
        priceSuffix: '/ mo',
        priceYear: 'or $149.99/yr',
        plan: 'commissioner',
        featured: false,
        badge: null,
        cta: 'Get Commissioner',
        features: [
          { text: 'Everything in Pro' },
          { text: 'Full commissioner tool suite' },
          { text: 'Dispersal draft & weighted lottery' },
          { text: 'Integrity monitoring & broadcast' },
        ],
      },
      {
        key: 'supreme',
        name: 'AF Supreme',
        price: '$19.99',
        priceSuffix: '/ mo',
        priceYear: 'or $199.99/yr',
        plan: 'supreme',
        featured: false,
        badge: null,
        cta: 'Get AF Supreme',
        features: [
          { text: 'Everything in Commissioner' },
          { text: 'Projections & projected edges' },
          { text: 'Cross-league analytics & portfolio' },
          { text: 'Higher monthly token allowance' },
        ],
      },
      {
        key: 'legacy',
        name: 'AF Legacy',
        price: '$29.99',
        priceSuffix: '/ mo',
        priceYear: 'or $299.99/yr',
        plan: 'war_room',
        featured: true,
        badge: 'Full output',
        cta: 'Get AF Legacy',
        features: [
          { text: 'Everything in Supreme' },
          { text: 'Live draft room' },
          { text: 'Dynasty & devy deep tools' },
          { text: 'Priority & early access' },
        ],
      },
    ],
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
    comingSoonNote: "{label} isn't available yet — coming soon.",
    platformSoon: 'Coming soon',
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
}
