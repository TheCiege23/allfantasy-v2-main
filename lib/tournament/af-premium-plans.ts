/**
 * AllFantasy premium plans + AF Token cost tiers for tournament / commissioner surfaces.
 * Wire to billing when SKU entitlements exist; UI uses these as source of truth for labels.
 */

export type AfPlanId = 'af_pro' | 'af_commissioner' | 'af_supreme'

export const AF_PLANS: Record<
  AfPlanId,
  { label: string; shortLabel: string; description: string; unlocks: string[] }
> = {
  af_pro: {
    label: 'AF Pro',
    shortLabel: 'Pro',
    description: 'Personal AI — lineups, outlooks, waivers, trades, draft help.',
    unlocks: [
      'User-facing AI tools',
      'Lineup & player insights',
      'Waiver / trade / draft assistants',
      'Survivor: threat map, social pulse, challenge outlook, jury projection, Exile status',
      'Survivor: tribe, Tribal Council, Exile and best-ball AI help (token metered)',
    ],
  },
  af_commissioner: {
    label: 'AF Commissioner',
    shortLabel: 'Commissioner',
    description: 'Commissioner AI — league health, fairness, automation, tournament ops.',
    unlocks: [
      'Anti-collusion & anti-tanking signals',
      'League health & fairness alerts',
      'Tournament automation & commissioner recommendations',
      'Survivor: mini-game planner, risk alerts, fairness radar',
      'Survivor: challenge, merge, Tribal Council and jury narration (token metered)',
    ],
  },
  af_supreme: {
    label: 'AF Supreme',
    shortLabel: 'Supreme',
    description: 'Full bundle — everything in AF Pro and AF Commissioner.',
    unlocks: [
      'All AF Pro features',
      'All AF Commissioner features',
      'Survivor: every premium command center tile',
      'Best value for power users',
    ],
  },
}

/** Token burn tiers (1 = light, 3 = deep). */
export const AF_TOKEN_COST_TIERS = {
  light: { tokens: 1, examples: 'Quick summaries, one pick rec, short Chimmy answer' },
  standard: { tokens: 2, examples: 'Trade breakdown, matchup sim, transition announcement draft' },
  deep: { tokens: 3, examples: 'Tournament-wide report, fairness scan, full draft-room sequence' },
} as const

export type MonetizationSurface = 'tournament_commissioner' | 'league_shell' | 'dashboard_ai'
