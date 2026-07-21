/**
 * All customer-facing strings for the V3 landing page.
 *
 * TWO HARD RULES enforced here:
 *
 * 1. **No bare "AI" in customer copy.** The assistant is named *Chimmy*; the
 *    systems are "intelligence", not "AI". `lib/monetization/catalog.ts` states
 *    the rule and `__tests__/no-ai-customer-copy.test.ts` guards `app/dashboard`
 *    for the same reason. Keep this file compliant even though it sits outside
 *    that guard's current scope.
 * 2. **Never surface the internal plan key `war_room`.** The customer-facing
 *    name for that tier is "Legacy".
 *
 * PRICES ARE NOT HARDCODED. They read from `lib/monetization/catalog.ts`, which
 * is the display source of truth. Four files previously hardcoded prices and
 * drifted from the catalog (fixed in PR #247) — this file must not become a
 * fifth. See docs + the pricing drift audit for background.
 */

import { getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'

/** Formats a catalog amount as `$14.99`, dropping a trailing `.00`. */
function priceOf(sku: Parameters<typeof getMonetizationCatalogItemBySku>[0]): string {
  const amount = getMonetizationCatalogItemBySku(sku)?.amountUsd
  if (typeof amount !== 'number') return '—'
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`
}

const PRO_MONTHLY = priceOf('af_pro_monthly')
const COMMISSIONER_MONTHLY = priceOf('af_commissioner_monthly')
const LEGACY_MONTHLY = priceOf('af_war_room_monthly')
const TOKENS_FROM = priceOf('af_tokens_5')

export const V3 = {
  // ── Nav ──────────────────────────────────────────────────────────────
  nav: {
    ariaHome: 'AllFantasy home',
    ariaPrimary: 'Primary',
    ariaFooter: 'Footer',
    signIn: 'Log In',
    getStarted: 'Get Started Free',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    groups: [
      {
        label: 'Product',
        items: [
          { label: 'How It Works', href: '/how-it-works', desc: 'Connect, analyze, act' },
          { label: 'Import Guides', href: '/import-guides', desc: 'Step-by-step per platform' },
          { label: 'Chimmy Intelligence', href: '/chimmy', desc: 'Ask anything about your leagues' },
          { label: 'Rankings', href: '/rankings', desc: 'Player and team rankings' },
          { label: 'Legacy', href: '/af-legacy', desc: 'Career history and achievements' },
        ],
      },
      {
        label: 'For Commissioners',
        items: [
          { label: 'Create a League', href: '/create-league', desc: 'Start a native league' },
          { label: 'Commissioner Tools', href: '/features', desc: 'Health, engagement, reports' },
          { label: 'Pricing', href: '/pricing', desc: 'Plans for commissioners' },
        ],
      },
      {
        label: 'Resources',
        items: [
          { label: 'Help Center', href: '/help-center', desc: 'Guides and answers' },
          { label: 'Blog', href: '/blog', desc: 'Product news and strategy' },
          { label: 'Roadmap', href: '/roadmap', desc: "What we're building" },
          { label: 'Platform Status', href: '/api-status', desc: 'Live service status' },
        ],
      },
      {
        label: 'About',
        items: [
          { label: 'About Us', href: '/about', desc: 'Who we are' },
          { label: 'Careers', href: '/careers', desc: 'Join the team' },
          { label: 'Partners', href: '/partners', desc: 'Work with us' },
          { label: 'Contact', href: '/contact', desc: 'Get in touch' },
        ],
      },
    ],
    pricing: { label: 'Pricing', href: '/pricing' },
  },

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    badge: 'The Fantasy Operating System',
    titleTop: 'Every Fantasy League.',
    titleAccent: 'One Dashboard.',
    sub: 'Connect your fantasy leagues from every platform you play and manage them all from one place. Search players, compare leagues, analyze trades, monitor waivers, and track your legacy — without jumping between apps.',
    badges: ['Read-only access', 'No league changes made', 'We show you where to go'],
    primary: 'Import My League',
    secondary: 'Explore Live Demo',
    tertiary: 'Try Without Account',
    fine: 'Free to explore · No credit card required',
  },

  // ── Dashboard mockup (illustrative sample data, not a live feed) ─────
  mock: {
    greeting: 'Welcome back, Blake',
    clock: 'Week 12 · Live',
    nav: ['Dashboard', 'My Leagues', 'My Team', 'Matchups', 'Players', 'Waivers', 'Trades', 'Draft', 'Rankings', 'Legacy', 'Messages', 'Settings'],
    stats: [
      { label: 'League Health', value: '82', suffix: 'Healthy', tone: 'good' as const },
      { label: 'Projected (Wk)', value: '128.6', suffix: '+8.7 vs avg', tone: 'neutral' as const },
      { label: 'Win Probability', value: '64%', suffix: '+9% wk', tone: 'cyan' as const },
      { label: 'League Standing', value: '2.1', suffix: 'of 12', tone: 'purple' as const },
    ],
    panels: {
      trend: 'Weekly Scoring Trend',
      strength: 'Position Strength',
      waiver: 'Waiver Impact',
    },
    leagues: [
      { name: 'Gridiron Legends', meta: '12-Team · PPR', record: '11-4', place: '1st', tone: '#8b5cf6' },
      { name: 'Sunday Sluggers', meta: '10-Team · Half PPR', record: '9-6', place: '4th', tone: '#06b6d4' },
      { name: 'Dynasty Warriors', meta: 'Dynasty SF', record: '7-5', place: '2nd', tone: '#22c55e' },
    ],
    chimmy: {
      label: 'Chimmy Intelligence',
      question: 'Should I start Lamb or Amon-Ra this week?',
      answer: 'Lamb. Better matchup grade and a higher target floor in this scoring format.',
    },
    trade: {
      title: 'Trade Analyzer',
      give: 'You Give',
      get: 'You Get',
      givePlayer: 'J. Jefferson',
      getPlayer: 'B. Robinson + 2026 1st',
      grade: 'B+',
    },
    notifications: {
      title: 'Notifications',
      items: [
        { text: 'Injury update on your RB2', tone: 'bad' as const },
        { text: 'Trending waiver pickup available', tone: 'cyan' as const },
        { text: 'New trade offer in Gridiron Legends', tone: 'purple' as const },
      ],
    },
  },

  // ── Transparency ─────────────────────────────────────────────────────
  trust: {
    eyebrow: 'Read-only by design',
    title: 'We read your data. You stay in control.',
    body: 'AllFantasy never makes changes to your leagues on other platforms. We analyze your league data, show you exactly what matters, and link you straight to the right page on the original site so you can take the action yourself.',
    cannotTitle: 'What AllFantasy cannot do',
    cannot: [
      'Set your lineups',
      'Accept or reject trades',
      'Draft players for you',
      'Change league settings',
      'Submit waiver claims',
      "Edit anything on another platform",
    ],
    canTitle: 'What AllFantasy does instead',
    can: [
      'Tells you what changed',
      'Shows where opportunities are',
      'Identifies who to target',
      'Recommends what to do next',
      'Links you to the exact page to do it',
    ],
    flow: [
      { title: 'We read', body: 'Your league data syncs in, read-only.', icon: 'link' },
      { title: 'We analyze', body: 'Rosters, scoring, trends, and news.', icon: 'brain' },
      { title: 'We recommend', body: 'Clear calls with the reasoning shown.', icon: 'lightbulb' },
      { title: 'We point the way', body: 'Deep link to the right page to act.', icon: 'arrow' },
    ],
  },

  // ── Platforms ────────────────────────────────────────────────────────
  platforms: {
    eyebrow: 'Connect your leagues',
    title: 'Bring every league into one place',
    sub: 'Choose your platform and we walk you through exactly how to import — step by step, no guesswork.',
    soonNote: 'Support in progress',
    soonCta: 'Notify me',
    workingNote: 'Available now',
  },

  // ── Wizard ───────────────────────────────────────────────────────────
  wizard: {
    steps: ['Choose Platform', 'How to Connect', 'Find Your Leagues', 'Import', 'Dashboard Ready'],
    chooseTitle: 'Which platform are your leagues on?',
    chooseSub: 'Pick one to see exactly what to do next.',
    connectTitle: 'How to connect',
    findTitle: 'Find your leagues',
    importingTitle: 'Importing your leagues',
    doneTitle: "You're all set",
    doneSub: 'Your leagues are ready. Taking you to your dashboard.',
    back: 'Back',
    next: 'Continue',
    goToDashboard: 'Open my dashboard',
    noAccountBadge: 'No account needed',
    accountBadge: 'Free account required',
    tryAnother: 'Try a different platform',
  },

  // ── Fantasy OS ───────────────────────────────────────────────────────
  os: {
    eyebrow: 'The Fantasy Operating System',
    title: 'Connected systems, not scattered tools',
    sub: 'Each system reads the same league data, so a waiver call knows about your trade talks and your draft knows about your roster holes.',
    cards: [
      { name: 'Decision OS', desc: 'Start/sit, add/drop, and trade calls scored against your league\'s real scoring settings.', example: '"Start Lamb over Amon-Ra — better matchup grade."', icon: 'target', href: '/features' },
      { name: 'Commissioner OS', desc: 'Run your league, track engagement, and keep every manager active and paying attention.', example: '"3 managers haven\'t set a lineup in 2 weeks."', icon: 'shield', href: '/features' },
      { name: 'Manager OS', desc: 'Your roster, your weekly plan, and the moves that actually move your record.', example: '"Your RB depth is the weakest in the league."', icon: 'users', href: '/features' },
      { name: 'Trade OS', desc: 'Evaluate offers, find fair deals, and see what each side really gains.', example: '"This offer is a B+ for you, C for them."', icon: 'swap', href: '/features' },
      { name: 'Waiver OS', desc: 'The pickups that help your roster before your league-mates get there.', example: '"Claim him at 14% FAAB — 3 teams need him."', icon: 'trending', href: '/features' },
      { name: 'Draft OS', desc: 'Live draft guidance, board tracking, and pick-by-pick value.', example: '"Best available for your build: WR, then RB."', icon: 'clipboard', href: '/features' },
      { name: 'Chimmy Intelligence', desc: 'Ask anything about your leagues in plain language and get a league-aware answer.', example: '"Which of my leagues need attention today?"', icon: 'sparkles', href: '/chimmy' },
      { name: 'Rankings', desc: 'Player and team rankings you can tune to your own scoring format.', example: '"Re-ranked for your Half-PPR TE-premium league."', icon: 'list', href: '/rankings' },
      { name: 'Legacy', desc: 'Every season, every championship, every rivalry — your permanent fantasy record.', example: '"4th championship. 9-season win rate: 61%."', icon: 'trophy', href: '/af-legacy' },
    ],
  },

  // ── Chimmy ───────────────────────────────────────────────────────────
  chimmy: {
    eyebrow: 'Chimmy Intelligence',
    title: 'Ask anything. Chimmy already knows your leagues.',
    sub: 'Chimmy reads your rosters, scoring settings, league history, transactions, injuries, and schedules — so answers fit the league you are actually asking about.',
    knows: ['Your current league', 'Rosters', 'Scoring settings', 'League history', 'Transactions', 'Waivers and trades', 'Draft results', 'Player news and injuries', 'Schedules'],
    examples: [
      'Who should I start at flex this week?',
      'Compare my Sleeper league to my ESPN league.',
      'Which of my leagues need attention?',
      'Find every injured player across all my leagues.',
      'Show me my top waiver priorities.',
    ],
    cta: 'Try Chimmy',
  },

  // ── Free tier ────────────────────────────────────────────────────────
  free: {
    eyebrow: 'No account required',
    title: 'Start in seconds',
    sub: 'Explore the product before you sign up for anything. Importing your own leagues and saving your setup is what needs a free account.',
    open: ['Search players', 'Browse rankings', 'Try Chimmy', 'View the demo dashboard', 'Compare players', 'Run the mock trade analyzer'],
    gated: 'Importing leagues, saving your dashboard, and personalized recommendations need a free account.',
    cta: 'Try Without an Account',
  },

  // ── Integrations ─────────────────────────────────────────────────────
  integrations: {
    eyebrow: 'More than fantasy',
    title: 'Your league lives where you already hang out',
    discord: {
      name: 'Discord',
      body: 'Connect your league to your Discord server for announcements, notifications, commissioner updates, and invite links.',
      features: ['League announcements', 'Score and injury notifications', 'Commissioner updates', 'Invite links'],
      cta: 'Connect Discord',
    },
    spotify: {
      name: 'Spotify',
      body: 'Link Spotify to set the mood while you manage your leagues and share playlists with your league-mates.',
      features: ['Listen while you manage', 'Shared league playlists', 'Draft-day playlists', 'Game-day mixes'],
      cta: 'Connect Spotify',
    },
  },

  // ── Pricing ──────────────────────────────────────────────────────────
  pricing: {
    eyebrow: 'Plans',
    title: 'Start free. Upgrade when it pays for itself.',
    sub: 'Every plan keeps the same unified dashboard. Higher tiers unlock deeper analysis, more league management, and larger token allowances.',
    compareCta: 'Compare all plans',
    plans: [
      {
        name: 'Free',
        price: '$0',
        period: 'forever',
        featured: false,
        cta: 'Start Free',
        href: null,
        features: ['Basic league management', 'Player search', 'Rankings and news', 'Demo dashboard', 'Sample Chimmy', 'Import preview'],
      },
      {
        name: 'Pro',
        price: PRO_MONTHLY,
        period: 'per month',
        featured: false,
        cta: 'Go Pro',
        href: '/upgrade?plan=pro',
        features: ['Everything in Free', 'Decision OS', 'Player and lineup insights', 'Trade and waiver tools', 'Start/sit advice', 'Advanced analytics'],
      },
      {
        name: 'Commissioner',
        price: COMMISSIONER_MONTHLY,
        period: 'per month',
        featured: true,
        cta: 'Go Commissioner',
        href: '/upgrade?plan=commissioner',
        features: ['Everything in Pro', 'Commissioner OS', 'League health dashboard', 'Manager engagement', 'League reports', 'Announcements and polls'],
      },
      {
        name: 'Tokens',
        price: TOKENS_FROM,
        period: 'pay as you go',
        featured: false,
        cta: 'Get Tokens',
        // No `?plan=` — tokens are a pack, not a plan family, and an unrecognized
        // plan param would just be discarded by /upgrade's normalizer.
        href: '/upgrade',
        features: ['One-time deep reports', 'Deep trade analysis', 'Dynasty reports', 'Championship roadmap', 'Advanced projections', 'No subscription needed'],
      },
      {
        name: 'Legacy',
        price: LEGACY_MONTHLY,
        period: 'per month',
        featured: false,
        cta: 'Get Legacy',
        href: '/upgrade?plan=legacy',
        features: ['Everything in Commissioner', 'All-time rankings', 'Achievements and badges', 'Historical analytics', 'Hall of Fame', 'Priority support'],
      },
    ],
  },

  // ── Sports ───────────────────────────────────────────────────────────
  sports: {
    eyebrow: 'All sports, all seasons',
    title: 'We support the fantasy sports you play',
    items: [
      { name: 'NFL', emoji: '🏈', live: true },
      { name: 'NCAAF', emoji: '🏈', live: true },
      { name: 'NBA', emoji: '🏀', live: true },
      { name: 'NCAAB', emoji: '🏀', live: true },
      { name: 'MLB', emoji: '⚾', live: true },
      { name: 'NHL', emoji: '🏒', live: true },
      { name: 'MLS', emoji: '⚽', live: true },
      { name: 'WNBA', emoji: '🏀', live: true },
      { name: 'PGA', emoji: '⛳', live: true },
      { name: 'Premier League', emoji: '⚽', live: true },
      { name: 'Champions League', emoji: '🏆', live: true },
      { name: 'World Cup', emoji: '🌍', live: true },
    ],
  },

  // ── Final CTA ────────────────────────────────────────────────────────
  finalCta: {
    title: 'Every league. One dashboard.',
    body: 'Bring your leagues together and stop hopping between apps. Free to start, no credit card.',
    primary: 'Import My League',
    secondary: 'Create a League',
  },

  // ── Footer ───────────────────────────────────────────────────────────
  footer: {
    tagline: 'The operating system for fantasy sports. Unify your leagues, get intelligent insight, and take your fantasy game to the next level.',
    badges: [
      { title: 'We never modify your leagues', icon: 'lock' },
      { title: 'Bank-level security and encryption', icon: 'shield' },
      { title: 'Built for serious managers', icon: 'users' },
      { title: 'Real data. Real time. Real results.', icon: 'zap' },
    ],
    columns: [
      {
        title: 'Product',
        links: [
          { label: 'Features', href: '/features' },
          { label: 'Chimmy Intelligence', href: '/chimmy' },
          { label: 'How It Works', href: '/how-it-works' },
          { label: 'Import Guides', href: '/import-guides' },
          { label: 'Demo Dashboard', href: '/demo-dashboard' },
          { label: 'Rankings', href: '/rankings' },
        ],
      },
      {
        title: 'Learn',
        links: [
          { label: 'Blog', href: '/blog' },
          { label: 'Help Center', href: '/help-center' },
          { label: 'Video Tutorials', href: '/video-tutorials' },
          { label: 'Platform Status', href: '/api-status' },
          { label: 'Roadmap', href: '/roadmap' },
        ],
      },
      {
        title: 'Company',
        links: [
          { label: 'About Us', href: '/about' },
          { label: 'Careers', href: '/careers' },
          { label: 'Press Kit', href: '/press' },
          { label: 'Partners', href: '/partners' },
          { label: 'Contact', href: '/contact' },
        ],
      },
      {
        title: 'Legal',
        links: [
          { label: 'Privacy Policy', href: '/privacy' },
          { label: 'Terms of Service', href: '/terms' },
          { label: 'No Gambling Policy', href: '/no-gambling' },
          { label: 'Data Usage', href: '/data-usage' },
          { label: 'Data Deletion', href: '/data-deletion' },
          { label: 'Security', href: '/security' },
        ],
      },
    ],
    copyright: `© ${new Date().getFullYear()} AllFantasy. All rights reserved.`,
    geoNote:
      'AllFantasy is a league management and analytics platform. It is not a gambling service and does not accept wagers or offer prizes of monetary value.',
  },
} as const
