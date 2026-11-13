/**
 * League privacy and invitation settings.
 * Stored in League.settings. Commissioner-controlled.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

export type LeagueVisibility = 'public' | 'private' | 'invite_only' | 'password_protected'

export interface LeaguePrivacySettings {
  visibility: LeagueVisibility
  /** Hashed password when visibility is password_protected; null otherwise. */
  passwordHash: string | null
  allowInviteLink: boolean
  allowEmailInvite: boolean
  allowUsernameInvite: boolean
  inviteCode: string | null
  inviteLink: string | null
  inviteExpiresAt: string | null
}

const SETTINGS_KEYS = {
  visibility: 'league_privacy_visibility',
  passwordHash: 'league_password_hash',
  allowInviteLink: 'league_allow_invite_link',
  allowEmailInvite: 'league_allow_email_invite',
  allowUsernameInvite: 'league_allow_username_invite',
  inviteCode: 'inviteCode',
  inviteLink: 'inviteLink',
  inviteExpiresAt: 'inviteExpiresAt',
} as const

const DEFAULT_VISIBILITY: LeagueVisibility = 'private'

function hashPassword(password: string, leagueId: string): string {
  const salt = process.env.LEAGUE_PASSWORD_SALT || 'league-privacy-salt'
  return crypto.pbkdf2Sync(password, salt + leagueId, 10000, 32, 'sha256').toString('hex')
}

function verifyPassword(password: string, leagueId: string, hash: string): boolean {
  return hashPassword(password, leagueId) === hash
}

function fromStorage(settings: Record<string, unknown>): LeaguePrivacySettings {
  const visibility = (settings[SETTINGS_KEYS.visibility] as LeagueVisibility) ?? DEFAULT_VISIBILITY
  const inviteExpiresRaw = settings[SETTINGS_KEYS.inviteExpiresAt]
  const inviteExpiresDate =
    inviteExpiresRaw instanceof Date
      ? inviteExpiresRaw
      : typeof inviteExpiresRaw === 'string' && inviteExpiresRaw.trim()
        ? new Date(inviteExpiresRaw)
        : null
  return {
    visibility: ['public', 'private', 'invite_only', 'password_protected'].includes(visibility) ? visibility : DEFAULT_VISIBILITY,
    passwordHash: (settings[SETTINGS_KEYS.passwordHash] as string) ?? null,
    allowInviteLink: (settings[SETTINGS_KEYS.allowInviteLink] as boolean) ?? true,
    allowEmailInvite: (settings[SETTINGS_KEYS.allowEmailInvite] as boolean) ?? false,
    allowUsernameInvite: (settings[SETTINGS_KEYS.allowUsernameInvite] as boolean) ?? false,
    inviteCode: (settings[SETTINGS_KEYS.inviteCode] as string) ?? null,
    inviteLink: (settings[SETTINGS_KEYS.inviteLink] as string) ?? null,
    inviteExpiresAt:
      inviteExpiresDate && !Number.isNaN(inviteExpiresDate.getTime())
        ? inviteExpiresDate.toISOString()
        : null,
  }
}

/**
 * Get privacy and invite settings for a league.
 */
export async function getLeaguePrivacySettings(leagueId: string): Promise<LeaguePrivacySettings> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const settings = (league?.settings as Record<string, unknown>) ?? {}
  return fromStorage(settings)
}

/**
 * Update privacy and invite settings (commissioner only). Password is hashed before storing.
 */
export async function updateLeaguePrivacySettings(
  leagueId: string,
  patch: Partial<Omit<LeaguePrivacySettings, 'passwordHash'> & { password?: string | null }>
): Promise<LeaguePrivacySettings> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league) throw new Error('League not found')

  const current = (league.settings as Record<string, unknown>) ?? {}
  const next = { ...current }

  if (patch.visibility !== undefined && ['public', 'private', 'invite_only', 'password_protected'].includes(patch.visibility)) {
    next[SETTINGS_KEYS.visibility] = patch.visibility
    if (patch.visibility !== 'password_protected') next[SETTINGS_KEYS.passwordHash] = null
  }
  if (patch.password !== undefined) {
    if (patch.password === null || patch.password === '') {
      next[SETTINGS_KEYS.passwordHash] = null
    } else {
      next[SETTINGS_KEYS.passwordHash] = hashPassword(patch.password, leagueId)
    }
  }
  if (patch.allowInviteLink !== undefined) next[SETTINGS_KEYS.allowInviteLink] = patch.allowInviteLink
  if (patch.allowEmailInvite !== undefined) next[SETTINGS_KEYS.allowEmailInvite] = patch.allowEmailInvite
  if (patch.allowUsernameInvite !== undefined) next[SETTINGS_KEYS.allowUsernameInvite] = patch.allowUsernameInvite
  if (patch.inviteCode !== undefined) next[SETTINGS_KEYS.inviteCode] = patch.inviteCode
  if (patch.inviteLink !== undefined) next[SETTINGS_KEYS.inviteLink] = patch.inviteLink
  if (patch.inviteExpiresAt !== undefined) next[SETTINGS_KEYS.inviteExpiresAt] = patch.inviteExpiresAt

  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: next as any, updatedAt: new Date() },
  })

  return fromStorage(next)
}

/**
 * Validate invite code and optional password; returns league id and name if valid.
 */
export async function validateLeagueJoin(
  code: string,
  password?: string | null
): Promise<
  | { valid: true; leagueId: string; name: string | null; sport: string; requiresPassword: boolean }
  | { valid: false; error: string }
> {
  const normalized = code?.trim()
  if (!normalized) return { valid: false, error: 'Missing invite code' }

  const leagues = await prisma.league.findMany({
    where: {},
    select: { id: true, name: true, sport: true, leagueSize: true, settings: true },
  })

  const league = leagues.find((l) => {
    const s = (l.settings as Record<string, unknown>) ?? {}
    return (s.inviteCode as string) === normalized || (s.inviteCode as string)?.toString()?.toLowerCase() === normalized.toLowerCase()
  })

  if (!league) return { valid: false, error: 'Invalid or expired invite code' }

  const settings = fromStorage((league.settings as Record<string, unknown>) ?? {})
  if (settings.visibility === 'private' && !settings.inviteCode) return { valid: false, error: 'League is not accepting joins' }
  if (settings.visibility === 'invite_only' && !settings.allowInviteLink) return { valid: false, error: 'Invite link is disabled' }
  if (settings.inviteExpiresAt) {
    const expiresAt = new Date(settings.inviteExpiresAt)
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return { valid: false, error: 'Invite has expired' }
    }
  }

  if (league.leagueSize != null) {
    const rosterCount = await prisma.roster.count({
      where: { leagueId: league.id },
    })
    if (rosterCount >= league.leagueSize) {
      return { valid: false, error: 'League is full' }
    }
  }

  const requiresPassword = settings.visibility === 'password_protected' && !!settings.passwordHash
  if (requiresPassword) {
    if (!password?.trim()) return { valid: true, leagueId: league.id, name: league.name, sport: league.sport, requiresPassword: true }
    const ok = verifyPassword(password, league.id, settings.passwordHash!)
    if (!ok) return { valid: false, error: 'Incorrect password' }
  }

  return {
    valid: true,
    leagueId: league.id,
    name: league.name,
    sport: league.sport,
    requiresPassword: false,
  }
}

/**
 * Check password for a league (when visibility is password_protected).
 */
export function checkLeaguePassword(leagueId: string, password: string, storedHash: string): boolean {
  return verifyPassword(password, leagueId, storedHash)
}

