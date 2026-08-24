import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import type { LeagueTileModel } from '@/components/core-app/league-tile/leagueTileModel'

/**
 * Synthetic data for the dev handoff preview.
 *
 * ⚠ EVERY NAME IN HERE IS OBVIOUSLY FAKE, ON PURPOSE. This file exists so a
 * reviewer can see the emails and the tile states without an account that
 * happens to be mid-draft, and the one thing it must never do is get mistaken
 * for production output. So the managers are "Reviewer One" and the league is
 * "Preview League" — nothing that reads like a real user's data.
 *
 * ⚠ THIS IS THE ONLY PLACE IN THE HANDOFF WORK WHERE NUMBERS ARE INVENTED, and
 * it is dev-only and unreachable in production. The real screens compute
 * everything from Postgres and withhold what they cannot read; see each loader's
 * header. If you are copying a shape out of here into product code, you are
 * about to ship a fabricated number.
 */

const NOW = new Date('2026-08-23T15:00:00Z')

export function previewNow(): Date {
  return NOW
}

// ── 27a — the five lifecycle states ────────────────────────────────────

export const TILE_STATES: LeagueTileModel[] = [
  {
    id: 'preview-league-0001',
    name: 'Preview Dynasty',
    platform: 'sleeper',
    formatLine: '2026 · 12-team · Dynasty PPR',
    status: {
      kind: 'predraft',
      label: 'Pre-draft',
      reason: 'drafts Sunday 8:00pm · you pick 1.04',
      tone: 'neutral',
    },
    href: '/core',
  },
  {
    id: 'preview-league-0002',
    name: 'Preview Redraft',
    platform: 'espn',
    formatLine: '2026 · 10-team · Half PPR',
    status: {
      kind: 'drafting',
      label: 'Drafting',
      reason: 'pick 1.04 in 2m',
      tone: 'accent',
    },
    href: '/core',
  },
  {
    id: 'preview-league-0003',
    name: 'Preview Superflex',
    platform: 'yahoo',
    formatLine: '2026 · 12-team · Superflex PPR',
    status: {
      kind: 'live',
      label: 'Live',
      reason: '4 of your 9 starters still to play',
      tone: 'live',
    },
    score: { you: 87.4, opponent: 91.2, opponentName: 'Reviewer Two', projected: false },
    href: '/core',
  },
  {
    id: 'preview-league-0004',
    name: 'Preview Guillotine',
    platform: 'sleeper',
    formatLine: '2026 · 18-team · Guillotine',
    status: {
      kind: 'upcoming',
      label: 'Week 12',
      reason: 'locks Sunday 1:00pm',
      tone: 'warn',
    },
    // Pre-game tiles show a PROJECTION rather than staying blank — the handoff's
    // stated difference from Sleeper's tile, which is empty until kickoff.
    score: { you: 118.6, opponent: 112.1, opponentName: 'Reviewer Three', projected: true },
    href: '/core',
  },
  {
    id: 'preview-league-0005',
    name: 'Preview Legacy',
    platform: 'cbs',
    formatLine: '2025 · 12-team · Standard',
    status: {
      kind: 'finished',
      label: 'Champion',
      reason: 'won the 2025 title · 11–3',
      tone: 'gold',
    },
    href: '/core',
  },
]

/**
 * The naming-collision bug from the handoff, reproduced.
 *
 * Six leagues whose names all truncate to the same thing is a real production
 * screenshot, not a hypothetical — this row exists so the fix can be seen
 * working rather than described.
 */
export const COLLIDING_TILES: LeagueTileModel[] = Array.from({ length: 6 }, (_, i) => ({
  id: `preview-collide-${1000 + i * 137}`,
  name: 'Guillotine League Season Six',
  platform: 'sleeper',
  formatLine: '2026 · 18-team · Guillotine',
  status: {
    kind: 'upcoming' as const,
    label: 'Week 12',
    reason: 'locks Sunday 1:00pm',
    tone: 'neutral' as const,
  },
  href: '/core',
}))

// ── 22c — push suppression input ───────────────────────────────────────

export const PREVIEW_ISSUES: CoreIssue[] = [
  {
    id: 'preview-issue-1',
    severity: 'bad',
    glyph: '!',
    title: "You're on the clock",
    meta: 'Sleeper › Draft · pick 1.04 in 2m',
    leagueId: 'preview-league-0002',
    leagueName: 'Preview Redraft',
    platform: 'sleeper',
    deadline: new Date(NOW.getTime() + 2 * 60_000),
    action: { label: 'Draft it', href: '/core/draft-hq', external: false },
  },
  {
    id: 'preview-issue-2',
    severity: 'bad',
    glyph: '!',
    title: 'Empty FLEX slot',
    meta: 'Sleeper › Lineup · locks in 1h 04m',
    leagueId: 'preview-league-0003',
    leagueName: 'Preview Superflex',
    platform: 'sleeper',
    deadline: new Date(NOW.getTime() + 64 * 60_000),
    action: { label: 'Open in Sleeper', href: 'https://sleeper.com/leagues/preview', external: true },
  },
  {
    id: 'preview-issue-3',
    severity: 'warn',
    glyph: '⇄',
    title: 'Trade offer waiting',
    meta: 'ESPN › Trade · expires in 5h 20m',
    leagueId: 'preview-league-0001',
    leagueName: 'Preview Dynasty',
    platform: 'espn',
    deadline: new Date(NOW.getTime() + 320 * 60_000),
    action: { label: 'Review it', href: '/core/trades', external: false },
  },
  {
    id: 'preview-issue-4',
    severity: 'warn',
    glyph: '◷',
    title: 'Waivers process tonight',
    meta: 'Sleeper › Waivers · 8h 00m',
    leagueId: 'preview-league-0004',
    leagueName: 'Preview Guillotine',
    platform: 'sleeper',
    deadline: new Date(NOW.getTime() + 480 * 60_000),
    action: { label: 'Queue it', href: '/core/waivers', external: false },
  },
  // Deadline-less rows. These are what collapse into "N more" — the whole point
  // of the suppression rule.
  ...Array.from({ length: 13 }, (_, i) => ({
    id: `preview-issue-quiet-${i}`,
    severity: 'info' as const,
    glyph: '·',
    title: 'League data is stale',
    meta: 'Never read',
    leagueId: `preview-quiet-${i}`,
    leagueName: `Preview Quiet ${i + 1}`,
    platform: 'sleeper',
    deadline: null,
    action: null,
  })),
]

// ── 22a — a graded trade ───────────────────────────────────────────────

function asset(name: string, position: string, points: number) {
  return {
    playerId: `preview-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    position,
    pointsBySeason: { '2025': points },
    creditedBySeason: {},
    departed: null,
    gamesMissedBySeason: { '2025': 0 },
  }
}

export const PREVIEW_TRADE: GradedTrade = {
  id: 'preview-trade-1',
  season: '2026',
  week: 3,
  createdIso: NOW.toISOString(),
  multiTeam: false,
  tie: false,
  hasPendingPicks: true,
  sides: [
    {
      rosterId: 1,
      ownerId: null,
      managerName: 'Reviewer One',
      teamName: 'Preview Ones',
      avatar: null,
      playersIn: [asset('Sample Runner', 'RB', 241.6)],
      playersOut: [asset('Sample Catcher', 'WR', 198.2), asset('Sample Tight', 'TE', 121.4)],
      picksIn: [],
      picksOut: [
        {
          season: '2027',
          round: 1,
          originalRosterId: 1,
          label: '2027 1st',
          resolved: null,
          pending: true,
          rerouted: false,
        },
      ],
      madePlayoffs: null,
      seasonNets: [],
      cumulativeNet: 0,
      initialGrade: 'C',
      currentGrade: 'C',
      trend: 'steady',
    },
    {
      rosterId: 2,
      ownerId: null,
      managerName: 'Reviewer Two',
      teamName: 'Preview Twos',
      avatar: null,
      playersIn: [asset('Sample Catcher', 'WR', 198.2), asset('Sample Tight', 'TE', 121.4)],
      playersOut: [asset('Sample Runner', 'RB', 241.6)],
      picksIn: [
        {
          season: '2027',
          round: 1,
          originalRosterId: 1,
          label: '2027 1st',
          resolved: null,
          pending: true,
          rerouted: false,
        },
      ],
      picksOut: [],
      madePlayoffs: null,
      seasonNets: [],
      cumulativeNet: 0,
      initialGrade: 'C',
      currentGrade: 'C',
      trend: 'steady',
    },
  ],
}

function expAsset(name: string, position: string, market: number | null, prior: number | null) {
  return {
    key: `preview-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    position,
    isPick: false,
    marketValue: market,
    valueStdDev: null,
    valueSpread: market != null ? Math.round(market * 0.12) : null,
    valueSources: ['af-value', 'fantasycalc'],
    valueConfidence: 'moderate' as const,
    priorPoints: prior,
    priorGames: prior != null ? 16 : null,
    priorPerGame: prior != null ? Math.round((prior / 16) * 10) / 10 : null,
  }
}

export const PREVIEW_EXPECTATION: TradeExpectation = {
  available: true,
  leagueNote: '12-team superflex dynasty · full PPR · TE premium (+0.5/rec)',
  priorSeason: '2025',
  scoringMode: 'league-scored',
  missing: ['2027 first-round pick landing spot'],
  sides: [
    {
      rosterId: 1,
      managerName: 'Reviewer One',
      assetsIn: [expAsset('Sample Runner', 'RB', 6200, 241.6)],
      assetsOut: [
        expAsset('Sample Catcher', 'WR', 4100, 198.2),
        expAsset('Sample Tight', 'TE', 2600, 121.4),
        {
          key: 'preview-2027-1st',
          name: '2027 1st',
          position: null,
          isPick: true,
          marketValue: 1800,
          valueStdDev: null,
          valueSpread: 700,
          valueSources: ['af-value'],
          valueConfidence: 'low' as const,
          priorPoints: null,
          priorGames: null,
          priorPerGame: null,
        },
      ],
      marketIn: 6200,
      marketOut: 8500,
      marketNet: -2300,
      priorIn: 241.6,
      priorOut: 319.6,
      priorNet: -78,
      positionDelta: { RB: 1, WR: -1, TE: -1 },
      starterGaps: [{ position: 'TE', required: 1, rostered: 0 }],
      projected: {
        letter: 'D',
        valueEdge: -0.31,
        valueNet: -2300,
        uncertainty: 900,
        insideNoise: false,
        productionDisagrees: false,
        confidence: 'moderate',
      },
    },
    {
      rosterId: 2,
      managerName: 'Reviewer Two',
      assetsIn: [
        expAsset('Sample Catcher', 'WR', 4100, 198.2),
        expAsset('Sample Tight', 'TE', 2600, 121.4),
      ],
      assetsOut: [expAsset('Sample Runner', 'RB', 6200, 241.6)],
      marketIn: 8500,
      marketOut: 6200,
      marketNet: 2300,
      priorIn: 319.6,
      priorOut: 241.6,
      priorNet: 78,
      positionDelta: { RB: -1, WR: 1, TE: 1 },
      starterGaps: [],
      projected: {
        letter: 'A',
        valueEdge: 0.31,
        valueNet: 2300,
        uncertainty: 900,
        insideNoise: false,
        productionDisagrees: false,
        confidence: 'moderate',
      },
    },
  ],
}
