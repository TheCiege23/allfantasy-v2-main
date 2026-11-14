import type { SettingsProfile } from './sections/settings-types'

/**
 * The Settings hub in plain words (2026-11-14). The owner's ask: every page should say what it is for
 * and what to do. Settings was a menu of 14 cards with nothing at the top, and the one thing the
 * owner's own account needed (a bio) sat in a corner as "80%".
 *
 * So the hub now leads with an answer — "Your account is set up", or the things that are not — and
 * every line of it is READ from the account, the same rule the nav badges already follow
 * (settingsNavBadges.ts): a claim about someone's own settings that the client cannot back is worse
 * than no claim at all.
 *
 * Pure, so the rules are testable and SettingsChrome stays a renderer.
 */

/** Settings tab ids an issue can point at. Kept as a literal union so this file needs no client import. */
export type GuideTab = 'profile' | 'security' | 'notifications' | 'billing'

/**
 * The optional profile fields the profile line counts, in the order the hub asks for them. One list,
 * so the headline and the Profile card cannot disagree.
 */
export const COMPLETION_FIELDS = ['displayName', 'bio', 'avatar', 'sports', 'timezone'] as const
export type CompletionField = (typeof COMPLETION_FIELDS)[number]

function isFilled(profile: NonNullable<SettingsProfile>, field: CompletionField): boolean {
  switch (field) {
    case 'displayName':
      return Boolean(profile.displayName)
    case 'bio':
      return Boolean(profile.bio)
    case 'avatar':
      return Boolean(profile.profileImageUrl || profile.avatarPreset)
    case 'sports':
      return Boolean(profile.preferredSports && profile.preferredSports.length > 0)
    case 'timezone':
      return Boolean(profile.timezone)
  }
}

/** Share of those fields filled, 0–100 — the sidebar card's meter on a tab. No fabricated denominator. */
export function completionPct(profile: SettingsProfile): number {
  if (!profile) return 0
  const filled = COMPLETION_FIELDS.filter((f) => isFilled(profile, f)).length
  return Math.round((filled / COMPLETION_FIELDS.length) * 100)
}

/** The first profile field still empty. Null when every one is filled, or with no profile. */
export function firstMissingField(profile: SettingsProfile): CompletionField | null {
  if (!profile) return null
  return COMPLETION_FIELDS.find((f) => !isFilled(profile, f)) ?? null
}

export type HubIssue =
  | { key: 'paymentDue'; tab: 'billing' }
  | { key: 'emailUnverified'; tab: 'security' }
  | { key: 'phoneUnverified'; tab: 'security' }
  | { key: 'notificationsOff'; tab: 'notifications' }
  | { key: 'profileField'; tab: 'profile'; field: CompletionField }

export type HubIssueInput = {
  profile: SettingsProfile
  /** `settingsNavBadges(profile).notifications` is set — nothing can reach this person. */
  notificationsOff: boolean
  /** The entitlement snapshot's status, or null while it loads / when there is none. */
  planStatus: string | null
}

/**
 * What on this account is not as the person probably wants it, most urgent first. Empty means the
 * account is set up.
 *
 * - A payment that did not go through comes first: the plan stops when the grace period ends.
 * - An unverified email or phone: those are how you get back in. A phone that was never added is NOT
 *   an issue — plenty of accounts have none.
 * - Notifications off: the one setting whose effect is invisible until something is missed.
 * - A profile field: last, and only the first missing one, so the headline asks for one thing.
 */
export function hubIssues({ profile, notificationsOff, planStatus }: HubIssueInput): HubIssue[] {
  const out: HubIssue[] = []
  if (planStatus === 'past_due' || planStatus === 'grace') out.push({ key: 'paymentDue', tab: 'billing' })
  if (profile) {
    if (profile.email && !profile.emailVerifiedAt) out.push({ key: 'emailUnverified', tab: 'security' })
    if (profile.phone && !profile.phoneVerifiedAt) out.push({ key: 'phoneUnverified', tab: 'security' })
  }
  if (notificationsOff) out.push({ key: 'notificationsOff', tab: 'notifications' })
  const missing = firstMissingField(profile)
  if (missing) out.push({ key: 'profileField', tab: 'profile', field: missing })
  return out
}

/** The Security card's one line. Null with no profile. */
export type SecurityState = 'emailUnverified' | 'phoneUnverified' | 'emailAndPhone' | 'emailOnly' | 'phoneOnly' | 'none'

export function securityState(profile: SettingsProfile): SecurityState | null {
  if (!profile) return null
  const email = Boolean(profile.email)
  const phone = Boolean(profile.phone)
  if (email && !profile.emailVerifiedAt) return 'emailUnverified'
  if (phone && !profile.phoneVerifiedAt) return 'phoneUnverified'
  if (email && phone) return 'emailAndPhone'
  if (email) return 'emailOnly'
  if (phone) return 'phoneOnly'
  return 'none'
}

/**
 * The accounts linked on the profile, by name. ⚠ Only the three the profile carries — the same three
 * `settingsNavBadges` counts — because ESPN and Yahoo are linked per league, and the card must not
 * name a different set from the section it opens.
 */
export function linkedAccountNames(profile: SettingsProfile): string[] {
  if (!profile) return []
  const out: string[] = []
  if (profile.sleeperUserId) out.push('Sleeper')
  if (profile.discordUserId) out.push('Discord')
  if (profile.spotifyConnectedAt) out.push('Spotify')
  return out
}
