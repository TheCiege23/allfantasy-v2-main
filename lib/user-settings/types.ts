/**
 * Types for the unified user settings and profile system.
 * Used across Sports App, Bracket Challenge, and AllFantasy Legacy.
 */

import type { LanguageCode } from "@/lib/i18n/constants"

export type ThemePreference = "dark" | "light" | "legacy" | "system"

/**
 * Longest display name the profile accepts — what other managers see on chat, standings and trades.
 * Enforced by UserProfileService and mirrored as the input's maxLength. Uncapped before 2026-10-02.
 */
export const MAX_DISPLAY_NAME_LENGTH = 50
export type PreferredLanguage = LanguageCode

/** Supported sport code (aligns with LeagueSport). */
export type PreferredSportCode = string
export type SignInProviderId =
  | "google"
  | "apple"
  | "spotify"
  | "facebook"
  | "instagram"
  | "x"
  | "tiktok"

export type LegacyImportProviderId =
  | "sleeper"
  | "yahoo"
  | "espn"
  | "mfl"
  | "fleaflicker"
  | "fantrax"

export interface ProviderConnectionStatus {
  id: SignInProviderId
  name: string
  configured: boolean
  linked: boolean
}

export interface LegacyImportConnectionStatus {
  id: LegacyImportProviderId
  linked: boolean
  available: boolean
  importStatus: string | null
  lastJobAt?: string
  error?: string
}

export interface LegalAcceptanceState {
  ageVerified: boolean
  termsAccepted: boolean
  disclaimerAccepted: boolean
  acceptedAt: string | null
}

export interface SecurityPreferencesState {
  emailVerified: boolean
  phoneVerified: boolean
  hasPassword: boolean
  recoveryMethods: ("email" | "phone")[]
}

export interface UserSettingsRecord {
  userId: string
  notificationSettings: Record<string, unknown> | null
  providerConnections: ProviderConnectionStatus[]
  importConnections: LegacyImportConnectionStatus[]
  legalAcceptanceState: LegalAcceptanceState
  securityPreferences: SecurityPreferencesState
  updatedAt: Date
}

export interface UserProfileForSettings {
  userId: string
  username: string
  email: string | null
  /**
   * The address's Unsubscribe state (lib/email/emailSubscription). Set by getSettingsSnapshot;
   * absent on profiles built elsewhere, which the dispatcher treats as "no opt-out known".
   */
  emailSubscription?: import("@/lib/email/emailSubscription").EmailSubscriptionState
  displayName: string | null
  profileImageUrl: string | null
  avatarPreset: string | null
  preferredLanguage: PreferredLanguage | null
  timezone: string | null
  /** Time Engine: last device IANA zone from client sync (mismatch UX). */
  deviceTimezoneLastSeen?: string | null
  /** Time Engine: last device local instant (skew detection). */
  deviceTimeLastSeen?: Date | null
  /** Time Engine: account TZ vs device TZ or clock skew. */
  timeMismatchFlag?: boolean
  /** Time Engine: last successful device time POST. */
  lastTimeContextAt?: Date | null
  themePreference: ThemePreference | null
  phone: string | null
  phoneVerifiedAt: Date | null
  emailVerifiedAt: Date | null
  ageConfirmedAt: Date | null
  verificationMethod: "EMAIL" | "PHONE" | null
  hasPassword: boolean
  profileComplete: boolean
  sleeperUsername: string | null
  /** Sleeper platform user id when linked */
  sleeperUserId: string | null
  sleeperLinkedAt: Date | null
  discordUserId: string | null
  discordUsername: string | null
  discordEmail: string | null
  discordAvatar: string | null
  discordGuildId: string | null
  discordConnectedAt: Date | null
  spotifyDisplayName: string | null
  spotifyConnectedAt: Date | null
  bio: string | null
  preferredSports: PreferredSportCode[] | null
  /** Notification preferences (NotificationPreferences shape from lib/notification-settings). */
  notificationPreferences: Record<string, unknown> | null
  onboardingStep: string | null
  onboardingCompletedAt: Date | null
  /** Minutes of inactivity before auto sign-out; null/0 = off (allowed: 30, 60, 240, 720, 1440). */
  sessionIdleTimeoutMinutes: number | null
  /** Denormalized rank snapshot from `user_profiles` (dashboard / settings). */
  rankTier?: string | null
  xpLevel?: number | null
  xpTotal?: number | null
  rankCalculatedAt?: Date | null
  careerWins?: number | null
  careerChampionships?: number | null
  careerSeasonsPlayed?: number | null
  careerLeaguesPlayed?: number | null
  /** ElevenLabs voice id for Chimmy TTS; null = use default / local only before sync. */
  chimmyTtsVoiceId: string | null
  /** AI Auto Start/Sit Protection (JSON) — learning, aggressiveness, notifications. */
  autoCoachPreferences?: Record<string, unknown> | null
  settings: UserSettingsRecord | null
  updatedAt: Date
}

/**
 * Public-facing profile DTO (no email, phone, or internal ids).
 * Used for /profile/[username] and shareable profile views.
 */
export interface PublicProfileDto {
  username: string
  displayName: string | null
  profileImageUrl: string | null
  avatarPreset: string | null
  bio: string | null
  preferredSports: string[] | null
}

export interface ProfileUpdatePayload {
  displayName?: string | null
  /** Normalized and validated in `UserProfileService`; updates `AppUser.username`. */
  username?: string | null
  preferredLanguage?: PreferredLanguage | null
  timezone?: string | null
  themePreference?: ThemePreference | null
  avatarPreset?: string | null
  avatarUrl?: string | null
  bio?: string | null
  preferredSports?: PreferredSportCode[] | null
  notificationPreferences?: Record<string, unknown> | null
  onboardingStep?: string | null
  onboardingCompletedAt?: Date | null
  /** Clears Sleeper link fields on `UserProfile`. */
  clearSleeperLink?: boolean
  /** Auto sign-out after idle period; null or 0 = off. */
  sessionIdleTimeoutMinutes?: number | null
  /** ElevenLabs `voice_id` for Chimmy; null clears to default voice behavior. */
  chimmyTtsVoiceId?: string | null
}

export interface UserSettingsUpdatePayload {
  notificationSettings?: Record<string, unknown> | null
}

export interface SettingsSnapshot {
  profile: UserProfileForSettings
  settings: UserSettingsRecord
}

export interface SettingsSavePayload {
  profile?: ProfileUpdatePayload
  settings?: UserSettingsUpdatePayload
  aiSettings?: Record<string, boolean>
  /** Resume alert emails after an Unsubscribe (lib/email/emailSubscription.resumeAlertEmails). */
  emailResubscribe?: boolean
}
