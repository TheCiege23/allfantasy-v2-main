/**
 * InviteValidationResolver — validate invite code and return preview or error.
 * Handles: invalid code, expired invite, league full, and optional already-member check.
 */

import { prisma } from "@/lib/prisma"
import { countSeatsHeldByPeople } from '@/lib/league/leagueSeats'
import crypto from "crypto"

export type InviteValidationError =
  | "INVALID_CODE"
  | "EXPIRED"
  | "LEAGUE_FULL"
  | "ALREADY_MEMBER"

export type FantasyInviteValidationError =
  | "INVALID_CODE"
  | "EXPIRED"
  | "LEAGUE_FULL"
  | "ALREADY_MEMBER"
  | "PASSWORD_REQUIRED"
  | "INCORRECT_PASSWORD"
  | "INVITE_DISABLED"

export interface LeagueInvitePreview {
  leagueId: string
  name: string
  tournamentName: string
  tournamentSeason?: string
  memberCount: number
  maxManagers: number
  isFull: boolean
  expired: boolean
  joinCode: string
}

export type InviteValidationResult =
  | { valid: true; preview: LeagueInvitePreview }
  | { valid: false; error: InviteValidationError; preview?: LeagueInvitePreview | null }

export interface FantasyLeagueInvitePreview {
  leagueId: string
  name: string | null
  sport: string
  memberCount: number
  leagueSize: number | null
  requiresPassword: boolean
  expired: boolean
  inviteCode: string
}

export type FantasyInviteValidationResult =
  | { valid: true; preview: FantasyLeagueInvitePreview }
  | { valid: false; error: FantasyInviteValidationError; preview?: FantasyLeagueInvitePreview | null }

/**
 * Normalize join code (uppercase, trim).
 */
export function normalizeJoinCode(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toUpperCase()
}

/**
 * Normalize fantasy invite code (trim, preserve case for display, lower-case for matching).
 */
export function normalizeFantasyInviteCode(raw: string | null | undefined): string {
  return String(raw ?? "").trim()
}

/**
 * Validate an invite code and return league preview or error.
 * Optionally pass userId to detect already-member (preview still returned for UI).
 */
export async function validateInviteCode(
  code: string | null | undefined,
  options?: { userId?: string | null }
): Promise<InviteValidationResult> {
  const joinCode = normalizeJoinCode(code)
  if (!joinCode) return { valid: false, error: "INVALID_CODE" }

  const league = await prisma.bracketLeague.findUnique({
    where: { joinCode },
    select: {
      id: true,
      name: true,
      maxManagers: true,
      inviteExpiresAt: true,
      tournament: { select: { name: true, season: true } },
      _count: { select: { members: true } },
    },
  })

  if (!league) return { valid: false, error: "INVALID_CODE" }

  const now = new Date()
  const expired = !!(
    league.inviteExpiresAt &&
    new Date(league.inviteExpiresAt) < now
  )
  if (expired) {
    const preview = toPreview(league, joinCode, true, false)
    return { valid: false, error: "EXPIRED", preview }
  }

  const memberCount = league._count?.members ?? 0
  const maxManagers = Number(league.maxManagers) || 100
  const isFull = memberCount >= maxManagers
  if (isFull) {
    const preview = toPreview(league, joinCode, false, true)
    return { valid: false, error: "LEAGUE_FULL", preview }
  }

  if (options?.userId) {
    const existing = await prisma.bracketLeagueMember.findUnique({
      where: {
        leagueId_userId: { leagueId: league.id, userId: options.userId },
      },
      select: { id: true },
    })
    if (existing) {
      const preview = toPreview(league, joinCode, false, isFull)
      return { valid: false, error: "ALREADY_MEMBER", preview }
    }
  }

  const preview = toPreview(league, joinCode, false, isFull)
  return { valid: true, preview }
}

const LEAGUE_VISIBILITY_KEY = "league_privacy_visibility"
const LEAGUE_PASSWORD_HASH_KEY = "league_password_hash"
const LEAGUE_ALLOW_INVITE_LINK_KEY = "league_allow_invite_link"
const LEAGUE_INVITE_EXPIRES_AT_KEY = "inviteExpiresAt"
const DEFAULT_LEAGUE_VISIBILITY = "private"

function hashFantasyLeaguePassword(password: string, leagueId: string): string {
  const salt = process.env.LEAGUE_PASSWORD_SALT || "league-privacy-salt"
  return crypto.pbkdf2Sync(password, salt + leagueId, 10000, 32, "sha256").toString("hex")
}

/**
 * Validate fantasy league invite code from League.settings.inviteCode.
 * Supports expiry, password-protected leagues, and duplicate-join detection.
 */
export async function validateFantasyInviteCode(
  code: string | null | undefined,
  options?: { userId?: string | null; password?: string | null }
): Promise<FantasyInviteValidationResult> {
  const normalized = normalizeFantasyInviteCode(code)
  if (!normalized) return { valid: false, error: "INVALID_CODE" }

  const leagues = await prisma.league.findMany({
    select: {
      id: true,
      name: true,
      sport: true,
      leagueSize: true,
      settings: true,
    },
  })

  const league = leagues.find((l) => {
    const settings = (l.settings as Record<string, unknown>) ?? {}
    const inviteCode = typeof settings.inviteCode === "string" ? settings.inviteCode.trim() : ""
    return inviteCode.toLowerCase() === normalized.toLowerCase()
  })

  if (!league) return { valid: false, error: "INVALID_CODE" }

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const inviteCode =
    typeof settings.inviteCode === "string" && settings.inviteCode.trim()
      ? settings.inviteCode.trim()
      : normalized
  const visibility =
    typeof settings[LEAGUE_VISIBILITY_KEY] === "string"
      ? String(settings[LEAGUE_VISIBILITY_KEY])
      : DEFAULT_LEAGUE_VISIBILITY
  const allowInviteLink =
    typeof settings[LEAGUE_ALLOW_INVITE_LINK_KEY] === "boolean"
      ? Boolean(settings[LEAGUE_ALLOW_INVITE_LINK_KEY])
      : true
  const passwordHash =
    typeof settings[LEAGUE_PASSWORD_HASH_KEY] === "string" && settings[LEAGUE_PASSWORD_HASH_KEY]
      ? String(settings[LEAGUE_PASSWORD_HASH_KEY])
      : null
  const inviteExpiresRaw = settings[LEAGUE_INVITE_EXPIRES_AT_KEY]
  const inviteExpiresAt =
    inviteExpiresRaw instanceof Date
      ? inviteExpiresRaw
      : typeof inviteExpiresRaw === "string" && inviteExpiresRaw.trim()
        ? new Date(inviteExpiresRaw)
        : null
  const expired = Boolean(
    inviteExpiresAt && !Number.isNaN(inviteExpiresAt.getTime()) && inviteExpiresAt.getTime() < Date.now()
  )

  // Seats held by people, not rosters that exist: a native league is created with a roster
  // for every seat, so counting rosters read every new league as full.
  const memberCount = await countSeatsHeldByPeople(prisma, league.id)
  const leagueSize = league.leagueSize ?? null
  const isFull = leagueSize != null && memberCount >= leagueSize
  const requiresPassword = visibility === "password_protected" && Boolean(passwordHash)
  const preview: FantasyLeagueInvitePreview = {
    leagueId: league.id,
    name: league.name,
    sport: league.sport,
    memberCount,
    leagueSize,
    requiresPassword,
    expired,
    inviteCode,
  }

  if (expired) return { valid: false, error: "EXPIRED", preview }
  if (visibility === "invite_only" && !allowInviteLink) {
    return { valid: false, error: "INVITE_DISABLED", preview }
  }
  if (options?.userId) {
    const existing = await prisma.roster.findUnique({
      where: {
        leagueId_platformUserId: { leagueId: league.id, platformUserId: options.userId },
      },
      select: { id: true },
    })
    if (existing) return { valid: false, error: "ALREADY_MEMBER", preview }
  }

  if (isFull) return { valid: false, error: "LEAGUE_FULL", preview }

  if (requiresPassword) {
    if (!options?.password?.trim()) return { valid: false, error: "PASSWORD_REQUIRED", preview }
    const hash = hashFantasyLeaguePassword(options.password.trim(), league.id)
    if (hash !== passwordHash) return { valid: false, error: "INCORRECT_PASSWORD", preview }
  }

  return { valid: true, preview }
}

function toPreview(
  league: {
    id: string
    name: string
    maxManagers: number
    inviteExpiresAt: Date | null
    tournament: { name: string; season?: string | number | null }
    _count: { members: number }
  },
  joinCode: string,
  expired: boolean,
  isFull: boolean
): LeagueInvitePreview {
  const memberCount = league._count?.members ?? 0
  const maxManagers = Number(league.maxManagers) || 100
  const season = league.tournament?.season
  return {
    leagueId: league.id,
    name: league.name,
    tournamentName: league.tournament?.name ?? "Tournament",
    tournamentSeason: season != null ? String(season) : undefined,
    memberCount,
    maxManagers,
    isFull,
    expired,
    joinCode,
  }
}
