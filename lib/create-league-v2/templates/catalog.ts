import type { LeagueCreationTemplateId, LeagueCreationTemplateMeta } from '@/lib/create-league-v2/templates/types'
import { LEAGUE_CREATION_TEMPLATE_IDS } from '@/lib/create-league-v2/templates/types'

export const LEAGUE_CREATION_TEMPLATES: Record<LeagueCreationTemplateId, LeagueCreationTemplateMeta> = {
  casual_redraft: {
    id: 'casual_redraft',
    title: 'Casual Home League',
    shortDescription:
      'Friendly redraft for friends and family — lighter commitment, classic snake draft, and defaults that stay out of your way.',
    recommendedPlayerType: 'Friends & family, casual managers, first-timers',
    gameplayStyle: 'Seasonal redraft — fresh rosters every year',
    rosterStyle: 'Balanced platform starter roster (sport-aware)',
    waiverStyle: 'Rolling / FAAB-friendly defaults you can tune later',
    draftStyle: 'Snake draft · 10 teams (adjustable)',
    scoringStyle: 'Half PPR–style presets on football; sport-appropriate defaults elsewhere',
    complexity: 'casual',
    visibilityRecommendation: 'Start private, open to invite-only or public later if you want listings.',
    visibilityHint: 'private',
    commissionerGuidance: 'Keep trade review on commissioner approval so you can help newer managers learn the ropes.',
  },
  competitive_redraft: {
    id: 'competitive_redraft',
    title: 'Competitive Redraft',
    shortDescription:
      'Sharper redraft defaults for active managers — full-season competition with a 12-team snake setup tuned for balance.',
    recommendedPlayerType: 'Active redraft managers, workplace leagues, competitive home leagues',
    gameplayStyle: 'High-engagement redraft with playoff-focused defaults',
    rosterStyle: 'Deeper benches and playoff-ready roster templates (sport-aware)',
    waiverStyle: 'FAAB-forward options available in Advanced',
    draftStyle: 'Snake draft · 12 teams (adjustable)',
    scoringStyle: 'Full PPR–leaning on football where available; sport-appropriate scoring list',
    complexity: 'moderate',
    visibilityRecommendation: 'Private or invite-only until the league is full; public OK for recruiting.',
    visibilityHint: 'public_or_private',
    commissionerGuidance: 'Consider league vote trade review once managers know each other — flip in Advanced.',
  },
  dynasty: {
    id: 'dynasty',
    title: 'Dynasty',
    shortDescription:
      'Long-term roster management with rookie drafts, taxi squads, and multi-season strategy — the full dynasty commissioner toolkit when you need it.',
    recommendedPlayerType: 'Committed managers, dynasty veterans, slow-draft friendly groups',
    gameplayStyle: 'Multi-year rosters, rookie drafts, taxi, and future picks',
    rosterStyle: 'Dynasty depth + taxi (sport-aware roster template)',
    waiverStyle: 'FAAB / rolling defaults you can refine pre-launch',
    draftStyle: 'Snake startup (offline or scheduled in Advanced)',
    scoringStyle: 'Platform dynasty scoring presets per sport',
    complexity: 'advanced',
    visibilityRecommendation: 'Start private while recruiting; dynasty often stays private or small-public.',
    visibilityHint: 'mostly_private',
    commissionerGuidance: 'Use Advanced for taxi rules, IR, and playoff seeding once your core settings are set.',
  },
  best_ball: {
    id: 'best_ball',
    title: 'Best Ball',
    shortDescription:
      'Set-and-forget best ball — optimized lineup scoring each week without weekly lineup stress. Great for large friend groups.',
    recommendedPlayerType: 'Busy pros, large pools, secondary leagues',
    gameplayStyle: 'Auto-optimized weekly scoring · season-long tournament feel',
    rosterStyle: 'Deep rosters, best-ball roster construction (sport-aware)',
    waiverStyle: 'Best-ball waiver templates (tunable after create)',
    draftStyle: 'Snake draft · 12 teams (adjustable)',
    scoringStyle: 'Sport-appropriate best-ball scoring presets',
    complexity: 'moderate',
    visibilityRecommendation: 'Public works for big pools; private for friend groups.',
    visibilityHint: 'public_or_private',
    commissionerGuidance: 'Confirm draft date or leave offline TBD — both are supported before and after create.',
  },
  guillotine: {
    id: 'guillotine',
    title: 'Guillotine',
    shortDescription:
      'Elimination-style pressure cooker — lowest score each period can be cut until one champion remains (rules tunable in Advanced).',
    recommendedPlayerType: 'Degens, content leagues, thrill seekers',
    gameplayStyle: 'High-variance elimination competition',
    rosterStyle: 'Guillotine-friendly roster sizing (sport-aware)',
    waiverStyle: 'Aggressive wire defaults — tune punishments and cuts in Advanced',
    draftStyle: 'Snake draft · 12 teams (adjustable)',
    scoringStyle: 'Sport-appropriate scoring list; football presets when applicable',
    complexity: 'advanced',
    visibilityRecommendation: 'Almost always private until rules are explained to the table.',
    visibilityHint: 'mostly_private',
    commissionerGuidance: 'Walk the group through cut cadence and consolation rules before going public.',
  },
}

export function getLeagueCreationTemplateMeta(id: LeagueCreationTemplateId): LeagueCreationTemplateMeta {
  return LEAGUE_CREATION_TEMPLATES[id]
}

export function listLeagueCreationTemplates(): LeagueCreationTemplateMeta[] {
  return LEAGUE_CREATION_TEMPLATE_IDS.map((id) => LEAGUE_CREATION_TEMPLATES[id])
}

export function isLeagueCreationTemplateId(value: string | null | undefined): value is LeagueCreationTemplateId {
  return typeof value === 'string' && (LEAGUE_CREATION_TEMPLATE_IDS as readonly string[]).includes(value)
}
