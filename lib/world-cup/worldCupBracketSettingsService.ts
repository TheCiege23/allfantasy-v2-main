import "server-only"
import crypto from "crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { DEFAULT_WORLD_CUP_SCORING } from "./worldCupBracketBuilder"
import type { WorldCupScoringValues } from "./types"
import {
  ensureWorldCupCommissionerSettings,
  emitWorldCupBracketChatEvent,
  getWorldCupCommissionerSettings,
  updateWorldCupCommissionerSettings,
} from "./worldCupBracketEventService"
import { WORLD_CUP_BRACKET_EVENT_TYPES } from "./worldCupBracketEvents"
import type { WorldCupBracketSettingsPatch } from "./worldCupBracketSettingsSchema"
import {
  getWorldCupKnockoutModeFromPayload,
  normalizeWorldCupKnockoutMode,
  type WorldCupKnockoutMode,
} from "./worldCupKnockoutMode"

const WORLD_CUP_MAX_PARTICIPANTS_CAP = 100
const WORLD_CUP_MAX_ENTRIES_PER_USER_CAP = 5

/** Env gate: allow commissioners to show everyone's picks before lock (otherwise admin-only). */
export function worldCupPublicPicksEarlyGloballyAllowed(): boolean {
  return process.env.WORLD_CUP_PUBLIC_PICKS_BEFORE_LOCK === "true"
}

type WorldCupLeagueSettingsStored = {
  scoringStyle?: "standard" | "custom"
  tiebreakerFinalScore?: boolean
  /** When false, new users cannot join after the bracket lock boundary. */
  allowLateJoin?: boolean
  /** Paid commissioner safety valve: participants may edit their own scheduled knockout picks after pool lock. */
  knockoutEditOverrideEnabled?: boolean
  showPublicPicks?: "after_lock" | "never" | "always"
  knockoutMode?: WorldCupKnockoutMode
  confidenceScoringEnabled?: boolean
  bracketBrainEnabled?: boolean
  joinPasswordHash?: string | null
}

type WorldCupLeagueSettingsUi = WorldCupLeagueSettingsStored & {
  inviteGateConfigured: boolean
}

function normalizePayloadObject(payload: unknown): Prisma.JsonObject {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...(payload as Prisma.JsonObject) }
  }
  return {} as Prisma.JsonObject
}

function joinPasswordSecret(): string {
  return (
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.WORLD_CUP_JOIN_SECRET ??
    "world-cup-join-fallback"
  )
}

export function hashWorldCupJoinPassword(plain: string): string {
  return crypto
    .createHmac("sha256", joinPasswordSecret())
    .update(`wc_join_v1:${plain}`)
    .digest("hex")
}

/** Raw hash for join verification (never expose to clients). */
export function getWorldCupJoinPasswordHashFromPayload(sourcePayload: unknown): string | null {
  const payload = sourcePayload as { leagueSettings?: { joinPasswordHash?: string | null } } | null
  const h = payload?.leagueSettings?.joinPasswordHash
  return typeof h === "string" && h.length > 0 ? h : null
}

export function parseWorldCupLeagueSettings(
  sourcePayload: unknown
): WorldCupLeagueSettingsUi {
  const payload = sourcePayload as { leagueSettings?: Partial<WorldCupLeagueSettingsStored> } | null
  const ls = payload?.leagueSettings ?? {}
  const inviteGateConfigured = Boolean(ls.joinPasswordHash)
  return {
    scoringStyle: ls.scoringStyle ?? "standard",
    tiebreakerFinalScore: ls.tiebreakerFinalScore ?? false,
    allowLateJoin: ls.allowLateJoin ?? false,
    knockoutEditOverrideEnabled: ls.knockoutEditOverrideEnabled === true,
    showPublicPicks: ls.showPublicPicks ?? "after_lock",
    knockoutMode: normalizeWorldCupKnockoutMode(ls.knockoutMode),
    confidenceScoringEnabled: ls.confidenceScoringEnabled === true,
    bracketBrainEnabled: ls.bracketBrainEnabled ?? true,
    inviteGateConfigured,
    joinPasswordHash: undefined,
  }
}

export function isWorldCupBracketBrainEnabledForChallenge(sourcePayload: unknown): boolean {
  const ls = parseWorldCupLeagueSettings(sourcePayload)
  return ls.bracketBrainEnabled !== false
}

export function isWorldCupConfidenceScoringEnabled(sourcePayload: unknown): boolean {
  return parseWorldCupLeagueSettings(sourcePayload).confidenceScoringEnabled === true
}

export function isWorldCupPostLockKnockoutEditOverrideEnabled(sourcePayload: unknown): boolean {
  return parseWorldCupLeagueSettings(sourcePayload).knockoutEditOverrideEnabled === true
}

/** Validates numeric scoring patch — exported for tests. */
export function assertPositiveScoringValues(input: Partial<WorldCupScoringValues>) {
  const keys: (keyof WorldCupScoringValues)[] = [
    "roundOf32Points",
    "roundOf16Points",
    "quarterFinalPoints",
    "semiFinalPoints",
    "finalPoints",
    "championBonusPoints",
  ]
  for (const k of keys) {
    if (input[k] === undefined) continue
    const n = Number(input[k])
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${String(k)} must be a positive number`)
    }
  }
  if (input.thirdPlacePoints !== undefined && input.thirdPlacePoints !== null) {
    const n = Number(input.thirdPlacePoints)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("thirdPlacePoints must be a positive number")
    }
  }
}

export async function getWorldCupBracketSettingsBundle(challengeId: string) {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: {
      scoringProfile: true,
    },
  })
  if (!challenge) return null

  await ensureWorldCupCommissionerSettings(challengeId)
  const commissioner = await getWorldCupCommissionerSettings(challengeId)

  const league = parseWorldCupLeagueSettings(challenge.sourcePayload)
  const scoring = challenge.scoringProfile

  return {
    challenge: {
      id: challenge.id,
      name: challenge.name,
      visibility: challenge.visibility as "public" | "private",
      inviteCode: challenge.inviteCode,
      maxParticipants: challenge.maxParticipants,
      maxEntriesPerParticipant: challenge.maxEntriesPerParticipant,
      includeThirdPlace: challenge.includeThirdPlace,
      pickLockStrategy: challenge.pickLockStrategy,
      pickLockAt: challenge.pickLockAt?.toISOString() ?? null,
    },
    scoring: scoring
      ? {
          roundOf32Points: scoring.roundOf32Points,
          roundOf16Points: scoring.roundOf16Points,
          quarterFinalPoints: scoring.quarterFinalPoints,
          semiFinalPoints: scoring.semiFinalPoints,
          finalPoints: scoring.finalPoints,
          championBonusPoints: scoring.championBonusPoints,
          thirdPlacePoints: scoring.thirdPlacePoints,
        }
      : { ...DEFAULT_WORLD_CUP_SCORING },
    leagueSettings: league,
    commissioner,
  }
}

export async function applyWorldCupBracketSettingsPatch(input: {
  challengeId: string
  userHasAfPro: boolean
  userHasAfCommissioner?: boolean
  isAdmin: boolean
  actorUserId?: string | null
  patch: WorldCupBracketSettingsPatch
}) {
  const { challengeId, userHasAfPro, userHasAfCommissioner, isAdmin, patch } = input
  const hasAdvancedCommissioner = Boolean(isAdmin || userHasAfCommissioner)

  if (patch.maxParticipants !== undefined) {
    if (patch.maxParticipants < 1 || patch.maxParticipants > WORLD_CUP_MAX_PARTICIPANTS_CAP) {
      throw new Error(`Max users must be between 1 and ${WORLD_CUP_MAX_PARTICIPANTS_CAP}`)
    }
  }
  if (patch.maxEntriesPerParticipant !== undefined) {
    if (
      patch.maxEntriesPerParticipant < 1 ||
      patch.maxEntriesPerParticipant > WORLD_CUP_MAX_ENTRIES_PER_USER_CAP
    ) {
      throw new Error(`Max brackets per user must be between 1 and ${WORLD_CUP_MAX_ENTRIES_PER_USER_CAP}`)
    }
  }

  if (patch.scoring) {
    assertPositiveScoringValues(patch.scoring as Partial<WorldCupScoringValues>)
  }

  const advancedSettingTouched = Boolean(
    patch.scoring ||
      patch.scoringStyle === "custom" ||
      patch.tiebreakerFinalScore !== undefined ||
      patch.allowLateJoin !== undefined ||
      patch.knockoutEditOverrideEnabled !== undefined ||
      patch.showPublicPicks !== undefined ||
      patch.knockoutMode !== undefined ||
      patch.confidenceScoringEnabled !== undefined ||
      patch.commissioner ||
      Object.prototype.hasOwnProperty.call(patch, "joinPassword")
  )
  if (advancedSettingTouched && !hasAdvancedCommissioner) {
    throw new Error(
      "AF Commissioner is required for custom scoring, custom locks, advanced invite controls, advanced notifications, and commissioner Chimmy settings."
    )
  }

  if (patch.showPublicPicks === "always") {
    if (!isAdmin && !worldCupPublicPicksEarlyGloballyAllowed()) {
      throw new Error(
        "Showing public picks before lock requires platform approval — choose “After lock” or contact support."
      )
    }
  }

  if (patch.bracketBrainEnabled === true && !userHasAfPro) {
    throw new Error("AF Pro is required to enable Bracket Brain for this pool.")
  }
  if (patch.commissioner?.enableAiSummaries === true && !userHasAfPro) {
    throw new Error("AF Pro is required to enable Chimmy summaries.")
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ch = await tx.worldCupBracketChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        sourcePayload: true,
        scoringProfileId: true,
        status: true,
        pickLockAt: true,
        entries: { select: { id: true } },
        picks: { select: { id: true }, take: 1 },
      },
    })
    if (!ch) throw new Error("Challenge not found")

    let scoringProfileId = ch.scoringProfileId
    if (!scoringProfileId) {
      const sp = await tx.worldCupBracketScoringProfile.create({
        data: { name: "World Cup Custom", ...DEFAULT_WORLD_CUP_SCORING },
      })
      scoringProfileId = sp.id
      await tx.worldCupBracketChallenge.update({
        where: { id: challengeId },
        data: { scoringProfileId: sp.id },
      })
    }

    const basePayload = normalizePayloadObject(ch.sourcePayload)
    const prevLeague = (basePayload.leagueSettings &&
    typeof basePayload.leagueSettings === "object" &&
    !Array.isArray(basePayload.leagueSettings)
      ? { ...(basePayload.leagueSettings as Record<string, unknown>) }
      : {}) as Record<string, unknown>

    const nextLeague: Record<string, unknown> = { ...prevLeague }

    if (
      patch.knockoutMode !== undefined &&
      patch.knockoutMode !== getWorldCupKnockoutModeFromPayload(ch.sourcePayload) &&
      !isAdmin &&
      ((ch.entries?.length ?? 0) > 0 ||
        (ch.picks?.length ?? 0) > 0 ||
        ch.status !== "open" ||
        ch.pickLockAt)
    ) {
      throw new Error("Knockout mode is locked after entries or picks begin. Admin override is required.")
    }

    if (patch.scoringStyle !== undefined) nextLeague.scoringStyle = patch.scoringStyle
    if (patch.tiebreakerFinalScore !== undefined) nextLeague.tiebreakerFinalScore = patch.tiebreakerFinalScore
    if (patch.allowLateJoin !== undefined) nextLeague.allowLateJoin = patch.allowLateJoin
    if (patch.knockoutEditOverrideEnabled !== undefined) {
      nextLeague.knockoutEditOverrideEnabled = patch.knockoutEditOverrideEnabled
    }
    if (patch.showPublicPicks !== undefined) nextLeague.showPublicPicks = patch.showPublicPicks
    if (patch.knockoutMode !== undefined) nextLeague.knockoutMode = patch.knockoutMode
    if (patch.confidenceScoringEnabled !== undefined) nextLeague.confidenceScoringEnabled = patch.confidenceScoringEnabled
    if (patch.bracketBrainEnabled !== undefined) nextLeague.bracketBrainEnabled = patch.bracketBrainEnabled

    if (Object.prototype.hasOwnProperty.call(patch, "joinPassword")) {
      const p = patch.joinPassword
      if (p === null || p === "") {
        nextLeague.joinPasswordHash = null
      } else if (typeof p === "string" && p.length > 0) {
        nextLeague.joinPasswordHash = hashWorldCupJoinPassword(p)
      }
    }

    if (patch.scoringStyle === "standard") {
      await tx.worldCupBracketScoringProfile.update({
        where: { id: scoringProfileId! },
        data: {
          ...DEFAULT_WORLD_CUP_SCORING,
          name: "World Cup Standard",
        },
      })
      nextLeague.scoringStyle = "standard"
    } else if (patch.scoring && Object.keys(patch.scoring).length > 0) {
      const raw = patch.scoring as Record<string, unknown>
      const scoringData = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== undefined)
      ) as Record<string, unknown>
      const becomesCustom =
        patch.scoringStyle === "custom" ||
        (patch.scoringStyle === undefined && nextLeague.scoringStyle !== "standard")
      await tx.worldCupBracketScoringProfile.update({
        where: { id: scoringProfileId! },
        data: {
          ...scoringData,
          ...(becomesCustom ? { name: "World Cup Custom" } : {}),
        },
      })
      if (patch.scoringStyle === "custom") {
        nextLeague.scoringStyle = "custom"
      } else if (patch.scoringStyle === undefined && Object.keys(scoringData).length > 0) {
        nextLeague.scoringStyle = "custom"
      }
    }

    basePayload.leagueSettings = nextLeague as unknown as Prisma.JsonValue

    const challengeData: Prisma.WorldCupBracketChallengeUpdateInput = {
      sourcePayload: basePayload,
    }

    if (patch.name !== undefined) challengeData.name = patch.name
    if (patch.visibility !== undefined) challengeData.visibility = patch.visibility
    if (patch.maxParticipants !== undefined) challengeData.maxParticipants = patch.maxParticipants
    if (patch.maxEntriesPerParticipant !== undefined) {
      challengeData.maxEntriesPerParticipant = patch.maxEntriesPerParticipant
    }
    if (patch.includeThirdPlace !== undefined) challengeData.includeThirdPlace = patch.includeThirdPlace

    await tx.worldCupBracketChallenge.update({
      where: { id: challengeId },
      data: challengeData,
    })

    if (patch.commissioner) {
      await ensureWorldCupCommissionerSettings(challengeId)
      await updateWorldCupCommissionerSettings({
        challengeId,
        ...patch.commissioner,
      })
    }
  })

  const shouldRecalc =
    patch.scoring != null ||
    patch.scoringStyle != null ||
    patch.includeThirdPlace !== undefined
  if (shouldRecalc) {
    await recalculateIfScoringChanged(challengeId)
  }

  if (patch.knockoutEditOverrideEnabled !== undefined) {
    await emitWorldCupBracketChatEvent({
      challengeId,
      userId: input.actorUserId ?? null,
      eventType: WORLD_CUP_BRACKET_EVENT_TYPES.KNOCKOUT_OVERRIDE,
      eventTitle: patch.knockoutEditOverrideEnabled
        ? "Commissioner knockout override enabled"
        : "Commissioner knockout override disabled",
      eventBody: patch.knockoutEditOverrideEnabled
        ? "Participants may edit scheduled knockout picks after the pool lock. Live, final, and per-match-started games remain locked."
        : "Post-lock knockout editing is disabled for this pool.",
      idempotencyKey: `world-cup:knockout-override-setting:${challengeId}:${crypto.randomUUID()}`,
      metadata: {
        enabled: patch.knockoutEditOverrideEnabled,
        audited: true,
        scope: "scheduled_knockout_picks_only",
      },
      force: true,
    }).catch(() => undefined)
  }
}

async function recalculateIfScoringChanged(challengeId: string) {
  try {
    const { recalculateWorldCupChallenge } = await import("./worldCupScoringService")
    await recalculateWorldCupChallenge(challengeId)
  } catch {
    /* non-fatal */
  }
}
