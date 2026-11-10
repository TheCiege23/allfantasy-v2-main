/**
 * The pricing page's "what each plan actually does": a couple of concrete examples per plan, and a
 * plain-language comparison table.
 *
 * 🛑 TIER AVAILABILITY IS COMPUTED, NEVER TYPED. Each paid row names the feature id the product
 * gates on, and `buildPlanComparison()` asks `hasFeatureAccessForPlans` — the same check the routes
 * enforce — which tiers unlock it. A row can therefore never claim a plan includes something the
 * paywall refuses, and moving a feature between plans moves its tick on this page with no edit here.
 * __tests__/monetization/planComparison.test.ts pins the result so a silent move is noticed.
 *
 * Free rows carry `featureId: null` because running a league is free by rule (the Oct 15 paywall),
 * not by an entitlement. "Coming soon" rows are read from the Commissioner OS roadmap
 * (components/core-app/screens/commissionersCopy.ts), so the two pages share one list of what is not
 * built yet.
 *
 * Copy rules: plain language, no internal feature ids, no "AI-powered" framing (the customer-facing
 * names are Chimmy, Commissioner OS, Competitive Edge), and nothing that reads as holding league money.
 */
import 'server-only'

import type { SubscriptionFeatureId, SubscriptionPlanId } from '@/lib/subscription/types'
import { hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'
import { CHIMMY_PLAN_DAILY_INCLUDED } from '@/lib/chimmy/planAllowanceView'
import { FREE_CHIMMY_QUESTIONS_PER_DAY } from '@/lib/tokens/freeChimmyQuestions'
import { COMMISSIONERS_ROADMAP } from '@/components/core-app/screens/commissionersCopy'

/** The four columns the pricing page sells, in its own order. */
export const COMPARISON_TIERS = ['free', 'af_pro', 'af_commissioner', 'af_supreme'] as const
export type ComparisonTier = (typeof COMPARISON_TIERS)[number]

const TIER_PLAN_IDS: Record<ComparisonTier, SubscriptionPlanId[]> = {
  free: [],
  af_pro: ['pro'],
  af_commissioner: ['commissioner'],
  af_supreme: ['supreme'],
}

/** One cell: included, not included, coming soon, or a short limit ("2 a day"). */
export type ComparisonCell = { kind: 'yes' } | { kind: 'no' } | { kind: 'soon' } | { kind: 'text'; text: string }

export type ComparisonRow = {
  id: string
  label: string
  /** One plain sentence under the label. */
  detail?: string
  /** Where Commissioner OS explains it. */
  learnMoreHref?: string
  cells: Record<ComparisonTier, ComparisonCell>
}

export type ComparisonGroup = { id: string; title: string; rows: ComparisonRow[] }

type RowSpec = {
  id: string
  label: string
  detail?: string
  learnMoreHref?: string
  /** null = free for everyone by rule. */
  featureId: SubscriptionFeatureId | null
}

const GROUPS: { id: string; title: string; rows: RowSpec[] }[] = [
  {
    id: 'run',
    title: 'Run your league — free on every plan',
    rows: [
      { id: 'leagues', label: 'Create and import unlimited leagues', featureId: null, learnMoreHref: '/commissioners#league-hub' },
      { id: 'season', label: 'Drafts, trades, waivers and live scoring', featureId: null },
      { id: 'basics', label: 'Commissioner basics: settings, invites and playoffs', featureId: null },
      {
        id: 'dues',
        label: 'Dues tracker',
        detail: 'See who has paid. Members pay the league directly — AllFantasy never holds the money.',
        featureId: null,
        learnMoreHref: '/commissioners#dues-tracker',
      },
    ],
  },
  {
    id: 'manage',
    title: 'Manage your own team',
    rows: [
      { id: 'trade_breakdown', label: 'The full trade breakdown', detail: 'Why a trade grades the way it does, its value layers, and counters worth sending.', featureId: 'trade_analyzer' },
      { id: 'player_depth', label: 'Player deep dives', detail: 'Trade, compare and verdict views for any player, with market and history.', featureId: 'player_ai_recommendations' },
      { id: 'competitive_edge', label: 'Competitive Edge', detail: 'What the other managers in your league have actually done — their trades, picks and waiver bids.', featureId: 'manager_psychology' },
      { id: 'start_sit', label: 'Start/sit calls', featureId: 'pro_start_sit' },
      { id: 'waivers', label: 'Waiver recommendations', featureId: 'ai_waivers' },
    ],
  },
  {
    id: 'commish',
    title: 'Commissioner OS',
    rows: [
      {
        id: 'league_health',
        label: 'Mission Control and League Health',
        detail: 'A health score for your league and the specific issues behind it — inactive managers, lineups that need attention.',
        featureId: 'commissioner_automation',
        learnMoreHref: '/commissioners#league-health',
      },
      {
        id: 'integrity',
        label: 'Integrity checks on lopsided trades',
        detail: 'Flags a trade worth a second look, with the reasoning, before it causes a fight.',
        featureId: 'ai_collusion_detection',
        learnMoreHref: '/commissioners#integrity',
      },
      { id: 'recaps', label: 'Weekly league recaps', featureId: 'commissioner_ai_recap' },
      { id: 'draft_as_me', label: 'Draft As Me', detail: 'When a manager misses a pick, Chimmy drafts the way that manager drafts.', featureId: 'commissioner_draft_as_me' },
      { id: 'scoring', label: 'Custom scoring tables', detail: 'Switching scoring presets stays free; building your own table is the paid part.', featureId: 'advanced_scoring' },
      { id: 'playoffs', label: 'Advanced playoff setup', featureId: 'advanced_playoff_setup' },
      { id: 'bb_narration', label: 'Big Brother ceremony narration', detail: 'Chimmy writes the HOH, eviction and finale ceremonies.', featureId: 'commissioner_ai_narration' },
    ],
  },
]

function cellFor(featureId: SubscriptionFeatureId | null, tier: ComparisonTier): ComparisonCell {
  if (featureId == null) return { kind: 'yes' }
  const plans = TIER_PLAN_IDS[tier]
  if (plans.length === 0) return { kind: 'no' }
  return hasFeatureAccessForPlans(plans, 'active', featureId) ? { kind: 'yes' } : { kind: 'no' }
}

function chimmyRow(): ComparisonRow {
  const cell = (tier: ComparisonTier): ComparisonCell => {
    const plans = TIER_PLAN_IDS[tier]
    const included = plans.length > 0 && hasFeatureAccessForPlans(plans, 'active', 'ai_chat')
    return { kind: 'text', text: `${included ? CHIMMY_PLAN_DAILY_INCLUDED : FREE_CHIMMY_QUESTIONS_PER_DAY} a day` }
  }
  return {
    id: 'chimmy',
    label: 'Chimmy answers about your leagues',
    detail: 'Ask Chimmy about any league you have connected. Tokens cover more when you need it.',
    cells: { free: cell('free'), af_pro: cell('af_pro'), af_commissioner: cell('af_commissioner'), af_supreme: cell('af_supreme') },
  }
}

export function buildPlanComparison(): ComparisonGroup[] {
  const groups: ComparisonGroup[] = GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    rows: g.rows.map((r) => ({
      id: r.id,
      label: r.label,
      detail: r.detail,
      learnMoreHref: r.learnMoreHref,
      cells: Object.fromEntries(COMPARISON_TIERS.map((t) => [t, cellFor(r.featureId, t)])) as Record<ComparisonTier, ComparisonCell>,
    })),
  }))
  groups.find((g) => g.id === 'manage')!.rows.unshift(chimmyRow())

  const soon: ComparisonCell = { kind: 'soon' }
  groups.push({
    id: 'soon',
    title: 'Coming soon',
    rows: COMMISSIONERS_ROADMAP.items.map((item, i) => ({
      id: `soon_${i}`,
      label: item.title,
      detail: item.body,
      cells: { free: soon, af_pro: soon, af_commissioner: soon, af_supreme: soon },
    })),
  })
  return groups
}

/**
 * One or two things a person can actually DO with each plan. Each names a feature the plan's gate
 * really opens (the test checks the feature against the tier), phrased as an outcome.
 */
export type PlanExample = { text: string; featureId: SubscriptionFeatureId | null; learnMoreHref?: string }

export const PLAN_EXAMPLES: Record<ComparisonTier, readonly PlanExample[]> = {
  free: [
    {
      text: "Bring every league you play into one place and track who has paid dues with your league's own payment links.",
      featureId: null,
      learnMoreHref: '/commissioners#dues-tracker',
    },
  ],
  af_pro: [
    { text: 'Open any trade and see why it grades the way it does — the value layers, and the counter-offer worth sending.', featureId: 'trade_analyzer' },
    { text: 'Before you send an offer, see what that manager has actually done: their past trades, draft picks and waiver bids.', featureId: 'manager_psychology' },
  ],
  af_commissioner: [
    {
      text: 'Open Mission Control and see your League Health score with the issues behind it — the inactive manager, the lineup that needs fixing.',
      featureId: 'commissioner_automation',
      learnMoreHref: '/commissioners#league-health',
    },
    { text: "When a manager misses their draft pick, let Chimmy pick the way they would have — Draft As Me.", featureId: 'commissioner_draft_as_me' },
  ],
  af_supreme: [
    {
      text: 'Run your league with Commissioner OS and get the full trade breakdown for your own team — one subscription instead of two.',
      featureId: 'commissioner_automation',
      learnMoreHref: '/commissioners#features',
    },
  ],
}

export function planExamplesAreConsistent(): boolean {
  return COMPARISON_TIERS.every((tier) =>
    PLAN_EXAMPLES[tier].every((ex) => (ex.featureId == null ? true : cellFor(ex.featureId, tier).kind === 'yes')),
  )
}
