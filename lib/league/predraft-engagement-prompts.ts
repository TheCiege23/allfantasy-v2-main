import type { LeagueFirstRunNiceEvidence } from '@/lib/league/first-run-types'

export type PredraftEngagementPromptId =
  | 'invite'
  | 'schedule_draft'
  | 'open_chat'
  | 'welcome'
  | 'listing'
  | 'payment'
  | 'scoring'
  | 'logo'

export type PredraftEngagementInput = {
  inviteOk: boolean
  draftScheduled: boolean
  /** Only treat as posted when server evidence explicitly true */
  welcomePosted: boolean
  publicListing: boolean
  /** Canonical paid league with homepage payment not fully on */
  needsPaymentSetup: boolean
  /** Non-standard scoring summary from dashboard (optional) */
  scoringNeedsAttention: boolean
  hasLeagueArt: boolean
  teamsJoined: number
  teamCapacity: number
}

function readWelcomePosted(evidence: LeagueFirstRunNiceEvidence | null): boolean {
  return evidence?.welcomeMessagePostedEvidence === true
}

/**
 * Picks at most `max` contextual prompts for commissioner predraft energy (deterministic order).
 */
export function pickPredraftEngagementPrompts(
  input: PredraftEngagementInput,
  evidence: LeagueFirstRunNiceEvidence | null,
  max = 3,
): PredraftEngagementPromptId[] {
  const welcomePosted = readWelcomePosted(evidence)
  const out: PredraftEngagementPromptId[] = []

  if (!input.inviteOk) out.push('invite')
  if (!input.draftScheduled) out.push('schedule_draft')
  if (!welcomePosted && evidence !== null) out.push('welcome')
  if (!input.publicListing) out.push('listing')
  if (input.needsPaymentSetup) out.push('payment')
  if (input.scoringNeedsAttention) out.push('scoring')
  if (!input.hasLeagueArt) out.push('logo')
  if (
    input.inviteOk &&
    input.draftScheduled &&
    welcomePosted &&
    input.teamsJoined < input.teamCapacity &&
    out.length < max
  ) {
    out.push('open_chat')
  }

  const dedup = [...new Set(out)]
  return dedup.slice(0, max)
}

export function needsCanonicalPaymentSetup(settings: Record<string, unknown>): boolean {
  const raw = settings.canonical_monetization
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const o = raw as Record<string, unknown>
  if (o.isPaidLeague !== true) return false
  return o.paymentEnabled !== true
}

export function isPublicListingEnabled(settings: Record<string, unknown>): boolean {
  if (settings.canonical_finder_listing_active === true) return true
  if (typeof settings.canonical_visibility === 'string' && settings.canonical_visibility.trim().toLowerCase() === 'public') {
    return true
  }
  const lv = settings.leagueListingVisibility
  if (typeof lv === 'string' && lv.trim().toLowerCase() === 'public') return true
  return false
}
