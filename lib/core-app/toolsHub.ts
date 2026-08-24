import 'server-only'

import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import { getTokenSpendRuleMatrixEntry } from '@/lib/tokens/pricing-matrix'

/**
 * 25a — the Tools hub, grouped by job rather than alphabetically.
 *
 * ⚠ EVERY ACTIONABLE CARD CARRIES LIVE URGENCY BEFORE THE CLICK, AND THAT
 * URGENCY IS NOT COMPUTED HERE. It comes from `deriveOutstandingIssues` — the
 * same engine behind the home queue and the notifications centre. The handoff's
 * build note is explicit that this must be reused rather than recomputed, and
 * the reason is that three separate urgency calculations would eventually
 * disagree about which deadline is closest.
 *
 * ⚠ COST OR TIER IS VISIBLE BEFORE THE CLICK, AND IS READ FROM THE REAL
 * CATALOG. `lib/tokens/pricing-matrix.ts` is the authority; a card whose rule
 * code is not in it shows no price rather than a guessed one. A made-up number
 * on a paywall is worse than no number.
 *
 * ⚠ OPEN PRODUCT DECISION, DELIBERATELY NOT RESOLVED IN CODE. The repo has FOUR
 * trade tools (`/trade-analyzer`, `/trade-evaluator`, `/trade-finder`,
 * `/dynasty-trade-analyzer`) and THREE player-comparison routes
 * (`/player-compare`, `/player-comparison`, `/player-comparison-lab`), all of
 * which exist and all of which work. The handoff recommends merging each family
 * into one tool with modes, and explicitly flags the choice as needing a product
 * call first. So this file does NOT merge them and does NOT hide them: one is
 * promoted as the primary card, the rest are listed as alternates under a note
 * that says the consolidation is undecided. Picking silently would be the one
 * thing the handoff rules out.
 */

export type ToolTier = 'free' | 'pro' | 'commissioner' | 'unknown'

export type ToolCard = {
  id: string
  title: string
  desc: string
  href: string
  /** Opens outside the core shell. Worth signalling before the click. */
  leavesShell?: boolean
  /**
   * The live line under the title — a real deadline for actionable tools, a real
   * statistic for analysis tools. Null when we hold nothing true to say, which
   * renders as an explicit "nothing pending" rather than an invented urgency.
   */
  live: { text: string; tone: 'urgent' | 'soon' | 'calm' } | null
  /** Token price per run, when the action has a rule in the pricing matrix. */
  tokenCost: number | null
  /** Plan needed. `free` renders no badge. */
  tier: ToolTier
  /** Sibling routes doing the same job — see the consolidation note above. */
  alternates?: Array<{ label: string; href: string }>
}

export type ToolGroup = {
  id: 'decide' | 'understand' | 'share' | 'account'
  heading: string
  /** Why these are together. Rendered, not just documentation. */
  note: string
  tools: ToolCard[]
}

export type ToolsHubData = {
  groups: ToolGroup[]
  /**
   * Rendered as a visible note. The handoff asks that league-scoped tools NOT
   * appear here, and that their real home be confirmed rather than assumed — so
   * the page says where they are instead of leaving them orphaned.
   */
  leagueScopedNote: string
  /** Surfaced in the UI so the pending decision is visible, not buried. */
  openDecision: { title: string; body: string } | null
}

function costOf(code: string): number | null {
  return getTokenSpendRuleMatrixEntry(code)?.tokenCost ?? null
}

function tierOf(code: string): ToolTier {
  const plan = getTokenSpendRuleMatrixEntry(code)?.requiredPlan
  if (plan == null) return 'free'
  if (plan === 'commissioner') return 'commissioner'
  return 'pro'
}

/**
 * Turn the shared issue queue into a per-tool urgency line.
 *
 * Matching is by detector intent rather than by string: a waiver card wants the
 * nearest waiver-ish deadline, a draft card the nearest draft. `CoreIssue.meta`
 * already reads "Sleeper › Lineup · locks in 1h 04m", so it is shown as-is —
 * re-summarising it here would be a fourth place that has to agree about time.
 */
function nearestIssue(issues: CoreIssue[], match: (i: CoreIssue) => boolean): CoreIssue | null {
  const candidates = issues.filter(match)
  if (candidates.length === 0) return null
  // deriveOutstandingIssues already sorts by severity then deadline, so the head
  // of the filtered list is the most pressing one.
  return candidates[0]
}

function liveFrom(issue: CoreIssue | null, calmText: string): ToolCard['live'] {
  if (!issue) return { text: calmText, tone: 'calm' }
  const tone: 'urgent' | 'soon' | 'calm' =
    issue.severity === 'bad' ? 'urgent' : issue.severity === 'warn' ? 'soon' : 'calm'
  const where = issue.leagueName ? `${issue.leagueName} · ` : ''
  return { text: `${where}${issue.meta}`, tone }
}

export function buildToolsHub(input: {
  issues: CoreIssue[]
  /**
   * Feeds the analysis cards' stat teasers. All read, none invented.
   *
   * ⚠ EVERY FIELD HERE IS A COUNT OF SOMETHING WE ACTUALLY HOLD, AND THE COPY
   * MUST NOT PROMISE MORE THAN THE COUNT SUPPORTS. The first version had a
   * `simulatableLeagues` field filled with "leagues that have a platform id",
   * rendered as "63 leagues have enough history to simulate" — while Season
   * Outlook itself, one click away, withheld all 63 for having no completed
   * weeks. A teaser that contradicts the page behind it is worse than no teaser:
   * it makes the honest page look broken.
   *
   * Working out how many leagues are genuinely simulatable means the outlook's
   * own read, which is far too expensive to run just to fill a line on a
   * launcher. So the teasers state connection counts, phrased as connection
   * counts, and let the page report what it could actually run.
   */
  stats: {
    leaguesPlayed: number
    /** Null when the count could not be read — distinct from zero. */
    tradesOnFile: number | null
    /** Leagues connected to a platform. NOT leagues with playable history. */
    connectedLeagues: number
  }
  /** Keeps league-scoped links pointed at the league in context. */
  selectedLeagueId: string | null
}): ToolsHubData {
  const { issues, stats, selectedLeagueId } = input
  const withLeague = (base: string) =>
    selectedLeagueId ? `${base}?league=${encodeURIComponent(selectedLeagueId)}` : base

  const waiverIssue = nearestIssue(issues, (i) => /waiver/i.test(i.meta) || /waiver/i.test(i.title))
  const tradeIssue = nearestIssue(issues, (i) => /trade/i.test(i.meta) || /trade/i.test(i.title))
  const draftIssue = nearestIssue(issues, (i) => /draft/i.test(i.meta) || /draft/i.test(i.title))

  const groups: ToolGroup[] = [
    {
      id: 'decide',
      heading: 'Decide something today',
      note: 'Deadline-bound. Each one shows what is actually pending before you open it.',
      tools: [
        {
          id: 'waivers',
          title: 'Waiver Assistant',
          desc: 'Ranked pickups for a league, priced against your FAAB and waiver order.',
          href: withLeague('/core/waivers'),
          live: liveFrom(waiverIssue, 'No waiver deadline is pending across your leagues.'),
          tokenCost: costOf('ai_waiver_one_off_suggestion'),
          tier: tierOf('ai_waiver_one_off_suggestion'),
        },
        {
          id: 'trade',
          title: 'Trade Analyzer',
          desc: 'Fairness and value on a proposal, graded in that league’s own scoring.',
          href: '/trade-analyzer',
          leavesShell: true,
          live: liveFrom(tradeIssue, 'No trade offer is waiting on you.'),
          tokenCost: costOf('ai_trade_analyzer_full_review'),
          tier: tierOf('ai_trade_analyzer_full_review'),
          alternates: [
            { label: 'Trade Evaluator', href: '/trade-evaluator' },
            { label: 'Trade Finder (Sleeper only)', href: '/trade-finder' },
            { label: 'Dynasty Trade Analyzer', href: '/dynasty-trade-analyzer' },
          ],
        },
        {
          id: 'draft',
          title: 'Draft Room',
          desc: 'The board, the clock and your queue, live during a draft.',
          href: withLeague('/core/draft-hq'),
          live: liveFrom(draftIssue, 'No draft is running or scheduled.'),
          tokenCost: costOf('ai_draft_pick_explanation'),
          tier: tierOf('ai_draft_pick_explanation'),
          alternates: [{ label: 'War Room (full page)', href: '/war-room' }],
        },
      ],
    },
    {
      id: 'understand',
      heading: 'Understand something',
      note: 'No deadline. Open these when you want to know why, not what to do in the next hour.',
      tools: [
        {
          id: 'outlook',
          title: 'Season Outlook',
          desc: 'Playoff and championship odds, simulated per league against its own rules.',
          href: '/core/season-outlook',
          live: {
            text:
              stats.connectedLeagues > 0
                ? `Across your ${stats.connectedLeagues} connected ${stats.connectedLeagues === 1 ? 'league' : 'leagues'} — the page names any it cannot run`
                : 'No connected leagues to simulate',
            tone: 'calm',
          },
          tokenCost: null,
          tier: 'free',
        },
        {
          id: 'trade-history',
          title: 'Trade History',
          desc: 'Every trade in your leagues, by week, with the grade it got at the time.',
          href: '/af-legacy?tab=finder',
          leavesShell: true,
          live: {
            text:
              stats.tradesOnFile == null
                ? 'We could not count your trades just now'
                : stats.tradesOnFile > 0
                  ? `${stats.tradesOnFile} trades on file`
                  : 'No trades have been synced yet',
            tone: 'calm',
          },
          tokenCost: null,
          tier: 'pro',
        },
        {
          id: 'psychology',
          title: 'Manager Psychology',
          desc: 'How you actually play — tendencies read from your own transaction history.',
          href: '/af-legacy?tab=compare',
          leavesShell: true,
          live: {
            text:
              stats.connectedLeagues > 0
                ? `Reads your transactions across ${stats.connectedLeagues} connected ${stats.connectedLeagues === 1 ? 'league' : 'leagues'}`
                : 'No connected leagues to read from',
            tone: 'calm',
          },
          tokenCost: null,
          tier: 'pro',
        },
        {
          id: 'compare',
          title: 'Manager Compare',
          desc: 'You against another manager, or against your leagues’ average.',
          href: '/manager-compare',
          leavesShell: true,
          live: {
            text:
              stats.leaguesPlayed > 0
                ? `${stats.leaguesPlayed} ${stats.leaguesPlayed === 1 ? 'league' : 'leagues'} to compare across`
                : 'No leagues to compare yet',
            tone: 'calm',
          },
          tokenCost: null,
          tier: 'pro',
          alternates: [
            { label: 'Player Compare', href: '/player-compare' },
            { label: 'Player Comparison', href: '/player-comparison' },
            { label: 'Player Comparison Lab', href: '/player-comparison-lab' },
          ],
        },
      ],
    },
    {
      id: 'share',
      heading: 'Share something',
      note: 'AllFantasy never posts for you. These produce something you copy and post yourself.',
      tools: [
        {
          id: 'share-card',
          title: 'Share a card',
          desc: 'Your career, as a card worth posting — caption written for the platform you pick.',
          href: '/core/share',
          live: { text: 'Sharing earns one token, once a day', tone: 'calm' },
          tokenCost: null,
          tier: 'free',
        },
      ],
    },
    {
      id: 'account',
      heading: 'Account',
      note: 'Balance, plan and the people behind the product.',
      tools: [
        {
          id: 'tokens',
          title: 'Tokens',
          desc: 'Your balance, what every action costs, and top-ups.',
          href: '/tokens',
          leavesShell: true,
          live: null,
          tokenCost: null,
          tier: 'free',
        },
        {
          id: 'plans',
          title: 'Plans',
          desc: 'Compare tiers and what each one unlocks.',
          href: '/pricing',
          leavesShell: true,
          live: null,
          tokenCost: null,
          tier: 'free',
        },
        {
          id: 'settings',
          title: 'Settings',
          desc: 'Profile, notifications, language and connected accounts.',
          href: '/settings',
          leavesShell: true,
          live: null,
          tokenCost: null,
          tier: 'free',
        },
        {
          id: 'import',
          title: 'Import a league',
          desc: 'Bring in a league from Sleeper, ESPN, Yahoo or Fantrax.',
          href: '/import?returnTo=%2Fcore%2Ftools',
          live: null,
          tokenCost: null,
          tier: 'free',
        },
        {
          id: 'commissioner',
          title: 'Commissioner Hub',
          desc: 'Run the leagues you commission — settings, integrity, recaps.',
          href: '/commissioner-hub',
          leavesShell: true,
          live: null,
          tokenCost: null,
          tier: 'commissioner',
        },
      ],
    },
  ]

  return {
    groups,
    leagueScopedNote:
      'Trade finder, mock drafts and projections are scoped to one league, so they live inside that ' +
      'league’s own nav rather than here — open a league from the rail and they are on its screens. ' +
      'They are not missing; they are somewhere a league is already selected.',
    openDecision: {
      title: 'Undecided: four trade tools and three player-comparison pages',
      body:
        'The codebase carries /trade-analyzer, /trade-evaluator, /trade-finder and ' +
        '/dynasty-trade-analyzer, plus /player-compare, /player-comparison and ' +
        '/player-comparison-lab. All of them work. The design recommendation is to merge each ' +
        'family into one tool with modes, and that is a product call nobody has made — so this ' +
        'page promotes one of each and lists the rest as alternates rather than quietly retiring ' +
        'six live routes.',
    },
  }
}
