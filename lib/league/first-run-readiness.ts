/**
 * Pure first-run readiness for commissioner onboarding (Phase 6A).
 * No I/O — callers pass flags derived from persisted league/settings state.
 */

export type ReadinessTier = 'not_ready' | 'almost_ready' | 'ready_to_invite' | 'ready_to_draft'

export type ReadinessChecklistItem = {
  id: string
  tier: 'must' | 'nice'
  label: string
  description?: string
  /** When null, the row is shown as guidance without a verified boolean (no invented state). */
  done: boolean | null
}

export type LeagueFirstRunReadinessInput = {
  /** User is commissioner or co-commissioner. */
  isCommissioner: boolean
  /** League owner (creator) — counts toward "seat" when no claimed team row yet. */
  isOwner: boolean
  userTeamId: string | null
  inviteTokenPresent: boolean
  draftScheduled: boolean
  /** Top-level `League.settings` JSON (partial). */
  settings: Record<string, unknown>
  /**
   * Welcome NICE row: include when defined (true/false). Omit key when evidence could not be loaded.
   * Phase 6B: server derives from `settings.leagueChatWelcomePosted` and/or commissioner league chat rows.
   */
  welcomeMessagePostedEvidence?: boolean | undefined
  /**
   * Scoring NICE row: include when defined. No persisted flag in product yet — usually omitted.
   */
  scoringReviewedEvidence?: boolean | undefined
}

export type LeagueFirstRunReadiness = {
  tier: ReadinessTier
  /** Human-readable badge for hero UI. */
  badgeLabel: string
  mustComplete: number
  mustTotal: number
  checklist: ReadinessChecklistItem[]
}

function readSettingsRecord(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {}
  return settings as Record<string, unknown>
}

function readCanonicalMonetization(
  s: Record<string, unknown>,
): { isPaidLeague: boolean; paymentEnabled: boolean } | null {
  const raw = s.canonical_monetization
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const paid = o.isPaidLeague
  const pe = o.paymentEnabled
  if (typeof paid !== 'boolean') return null
  if (typeof pe !== 'boolean') return null
  return { isPaidLeague: paid, paymentEnabled: pe }
}

/** Paid / Free chip in hero — only when canonical monetization block exists. */
export function readCanonicalPaidFreeLabel(settings: unknown): 'Paid' | 'Free' | null {
  const m = readCanonicalMonetization(readSettingsRecord(settings))
  if (!m) return null
  return m.isPaidLeague ? 'Paid' : 'Free'
}

/** Public / Private / Invite-only — only when canonical or listing visibility is persisted. */
export function readHeroVisibilityLabel(settings: unknown): 'Public' | 'Private' | 'Invite-only' | null {
  const s = readSettingsRecord(settings)
  const cv = s.canonical_visibility
  if (typeof cv === 'string') {
    const m = cv.trim().toLowerCase()
    if (m === 'public') return 'Public'
    if (m === 'private') return 'Private'
    if (m === 'invite_only' || m === 'invite-only') return 'Invite-only'
  }
  const lv = s.leagueListingVisibility
  if (typeof lv === 'string') {
    const m = lv.trim().toLowerCase()
    if (m === 'public') return 'Public'
    if (m === 'private') return 'Private'
  }
  return null
}

function isPublicListingEnabled(s: Record<string, unknown>): boolean {
  if (s.canonical_finder_listing_active === true) return true
  if (typeof s.canonical_visibility === 'string' && s.canonical_visibility.trim().toLowerCase() === 'public') {
    return true
  }
  const lv = s.leagueListingVisibility
  if (typeof lv === 'string' && lv.trim().toLowerCase() === 'public') return true
  return false
}

function commissionerOrTeamReady(input: LeagueFirstRunReadinessInput): boolean {
  return input.isCommissioner && (Boolean(input.userTeamId) || input.isOwner)
}

function resolveTier(must: { seat: boolean; invite: boolean; draft: boolean }): ReadinessTier {
  const { seat, invite, draft } = must
  if (!seat) return 'not_ready'
  if (seat && invite && draft) return 'ready_to_draft'
  if (seat && invite && !draft) return 'ready_to_invite'
  return 'almost_ready'
}

function badgeForTier(tier: ReadinessTier): string {
  switch (tier) {
    case 'ready_to_draft':
      return 'Ready to draft'
    case 'ready_to_invite':
      return 'Ready to invite'
    case 'almost_ready':
      return 'Almost ready'
    default:
      return 'Setup needed'
  }
}

/**
 * Computes checklist + summary tier from persisted-backed inputs only.
 */
export function computeLeagueReadiness(input: LeagueFirstRunReadinessInput): LeagueFirstRunReadiness {
  const s = readSettingsRecord(input.settings)
  const seat = commissionerOrTeamReady(input)
  const invite = input.inviteTokenPresent
  const draft = input.draftScheduled
  const tier = resolveTier({ seat, invite, draft })

  const mustRows: ReadinessChecklistItem[] = [
    {
      id: 'must_seat',
      tier: 'must',
      label: 'Commissioner seat & roster claim',
      description: 'You are commissioner and have claimed a team (or you own this league).',
      done: seat,
    },
    {
      id: 'must_invite',
      tier: 'must',
      label: 'Invite link available',
      description: 'Share the invite so managers can join.',
      done: invite,
    },
    {
      id: 'must_draft',
      tier: 'must',
      label: 'Draft scheduled',
      description: 'Set a draft date so everyone can plan.',
      done: draft,
    },
  ]

  const niceRows: ReadinessChecklistItem[] = []

  if (input.welcomeMessagePostedEvidence !== undefined) {
    niceRows.push({
      id: 'nice_welcome',
      tier: 'nice',
      label: 'Welcome message posted',
      description: 'Head commissioner or co-commissioner posted in main league chat (or system welcome flag).',
      done: input.welcomeMessagePostedEvidence === true,
    })
  }

  if (input.scoringReviewedEvidence !== undefined) {
    niceRows.push({
      id: 'nice_scoring',
      tier: 'nice',
      label: 'Scoring reviewed',
      description: 'Confirm scoring matches what you want.',
      done: input.scoringReviewedEvidence === true,
    })
  }

  niceRows.push({
    id: 'nice_listing',
    tier: 'nice',
    label: 'Public listing enabled',
    description: 'Listed for discovery when you want visibility.',
    done: isPublicListingEnabled(s),
  })

  const cm = readCanonicalMonetization(s)
  if (cm?.isPaidLeague) {
    niceRows.push({
      id: 'nice_payment',
      tier: 'nice',
      label: 'Payment setup complete',
      description: 'Homepage payment tools are on and configured.',
      done: cm.paymentEnabled === true,
    })
  }

  const checklist = [...mustRows, ...niceRows]
  const mustComplete = mustRows.filter((r) => r.done === true).length

  return {
    tier,
    badgeLabel: badgeForTier(tier),
    mustComplete,
    mustTotal: mustRows.length,
    checklist,
  }
}

/** Remove only `created` from query; preserve guide, openChat, showInvite, playIntro, view, tab, etc. */
export function stripCreatedQueryParam(search: string): string {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  q.delete('created')
  const out = q.toString()
  return out ? `?${out}` : ''
}
