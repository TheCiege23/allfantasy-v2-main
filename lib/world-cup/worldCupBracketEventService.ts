import "server-only"
import { prisma } from "@/lib/prisma"
import {
  toPoolChatSystemType,
  WORLD_CUP_BRACKET_EVENT_TYPES,
  type WorldCupPoolChatSystemKind,
} from "./worldCupBracketEvents"

export type WorldCupCommissionerSettingsResolved = {
  enableSystemEvents: boolean
  enableAiSummaries: boolean
  enableUpsetAlerts: boolean
  enableLeaderboardAlerts: boolean
  enableChampionBustAlerts: boolean
  enableLockReminders: boolean
}

const DEFAULT_SETTINGS: WorldCupCommissionerSettingsResolved = {
  enableSystemEvents: true,
  enableAiSummaries: false,
  enableUpsetAlerts: true,
  enableLeaderboardAlerts: true,
  enableChampionBustAlerts: true,
  enableLockReminders: true,
}

function defaultWorldCupCommissionerSettings(): WorldCupCommissionerSettingsResolved {
  return { ...DEFAULT_SETTINGS }
}

function getPrismaDelegateMethod(delegateName: string, methodName: string) {
  const delegate = (prisma as any)?.[delegateName]
  const method = delegate?.[methodName]
  return typeof method === "function" ? method.bind(delegate) : null
}

function booleanSetting(
  row: Record<string, unknown>,
  key: keyof WorldCupCommissionerSettingsResolved
) {
  const value = row[key]
  return typeof value === "boolean" ? value : DEFAULT_SETTINGS[key]
}

export async function ensureWorldCupCommissionerSettings(challengeId: string) {
  return (prisma as any).worldCupBracketCommissionerSettings.upsert({
    where: { challengeId },
    create: { challengeId },
    update: {},
  })
}

export async function getWorldCupCommissionerSettings(
  challengeId: string
): Promise<WorldCupCommissionerSettingsResolved> {
  const findUnique = getPrismaDelegateMethod(
    "worldCupBracketCommissionerSettings",
    "findUnique"
  )
  if (!findUnique) return defaultWorldCupCommissionerSettings()

  let row: Record<string, unknown> | null = null
  try {
    row = await findUnique({
      where: { challengeId },
    })
  } catch {
    return defaultWorldCupCommissionerSettings()
  }
  if (!row) return defaultWorldCupCommissionerSettings()

  return {
    enableSystemEvents: booleanSetting(row, "enableSystemEvents"),
    enableAiSummaries: booleanSetting(row, "enableAiSummaries"),
    enableUpsetAlerts: booleanSetting(row, "enableUpsetAlerts"),
    enableLeaderboardAlerts: booleanSetting(row, "enableLeaderboardAlerts"),
    enableChampionBustAlerts: booleanSetting(row, "enableChampionBustAlerts"),
    enableLockReminders: booleanSetting(row, "enableLockReminders"),
  }
}

export async function updateWorldCupCommissionerSettings(input: {
  challengeId: string
  enableSystemEvents?: boolean
  enableAiSummaries?: boolean
  enableUpsetAlerts?: boolean
  enableLeaderboardAlerts?: boolean
  enableChampionBustAlerts?: boolean
  enableLockReminders?: boolean
}) {
  await ensureWorldCupCommissionerSettings(input.challengeId)
  return (prisma as any).worldCupBracketCommissionerSettings.update({
    where: { challengeId: input.challengeId },
    data: {
      ...(input.enableSystemEvents !== undefined && {
        enableSystemEvents: input.enableSystemEvents,
      }),
      ...(input.enableAiSummaries !== undefined && {
        enableAiSummaries: input.enableAiSummaries,
      }),
      ...(input.enableUpsetAlerts !== undefined && {
        enableUpsetAlerts: input.enableUpsetAlerts,
      }),
      ...(input.enableLeaderboardAlerts !== undefined && {
        enableLeaderboardAlerts: input.enableLeaderboardAlerts,
      }),
      ...(input.enableChampionBustAlerts !== undefined && {
        enableChampionBustAlerts: input.enableChampionBustAlerts,
      }),
      ...(input.enableLockReminders !== undefined && {
        enableLockReminders: input.enableLockReminders,
      }),
    },
  })
}

type EmitWorldCupBracketEventInput = {
  challengeId: string
  eventType: string
  eventTitle: string
  eventBody: string
  idempotencyKey: string
  bracketEntryId?: string | null
  userId?: string | null
  metadata?: Record<string, unknown>
  isAiGenerated?: boolean
  /** When true, ignores commissioner toggles (critical ops only — unused by default). */
  force?: boolean
}

/** Export for hooks that need granular gates */
function isWorldCupLockReminderEventType(eventType: string): boolean {
  return (
    eventType === WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER ||
    eventType === WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_24H ||
    eventType === WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_6H ||
    eventType === WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_1H ||
    eventType === WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_15M
  )
}

export function shouldEmitWorldCupEvent(
  settings: WorldCupCommissionerSettingsResolved,
  eventType: string,
  isAiGenerated: boolean
): boolean {
  if (isAiGenerated) {
    return settings.enableSystemEvents && settings.enableAiSummaries
  }
  if (!settings.enableSystemEvents) return false
  switch (eventType) {
    case WORLD_CUP_BRACKET_EVENT_TYPES.UPSET:
      return settings.enableUpsetAlerts
    case WORLD_CUP_BRACKET_EVENT_TYPES.LEADERBOARD_LEAD_CHANGE:
    case WORLD_CUP_BRACKET_EVENT_TYPES.TOOK_FIRST_PLACE:
      return settings.enableLeaderboardAlerts
    case WORLD_CUP_BRACKET_EVENT_TYPES.CHAMPION_PICK_ELIMINATED:
      return settings.enableChampionBustAlerts
    case WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER:
    case WORLD_CUP_BRACKET_EVENT_TYPES.INCOMPLETE_BRACKETS_WARNING:
      return settings.enableLockReminders
    case WORLD_CUP_BRACKET_EVENT_TYPES.COMMISSIONER_BRAIN_MESSAGE:
      return settings.enableSystemEvents && settings.enableAiSummaries
    default:
      if (isWorldCupLockReminderEventType(eventType)) {
        return settings.enableLockReminders
      }
      return true
  }
}

export async function emitWorldCupBracketChatEvent(
  input: EmitWorldCupBracketEventInput
): Promise<{ ok: boolean; duplicate?: boolean; skipped?: boolean }> {
  const settings = await getWorldCupCommissionerSettings(input.challengeId)
  const isAi = Boolean(input.isAiGenerated)
  if (!input.force && !shouldEmitWorldCupEvent(settings, input.eventType, isAi)) {
    return { ok: false, skipped: true }
  }

  const createChatEvent = getPrismaDelegateMethod(
    "worldCupBracketChatEvent",
    "create"
  )
  if (!createChatEvent) {
    return { ok: false, skipped: true }
  }

  try {
    await createChatEvent({
      data: {
        challengeId: input.challengeId,
        bracketEntryId: input.bracketEntryId ?? null,
        userId: input.userId ?? null,
        eventType: input.eventType,
        eventTitle: input.eventTitle,
        eventBody: input.eventBody,
        metadata: (input.metadata ?? {}) as object,
        idempotencyKey: input.idempotencyKey,
        isAiGenerated: isAi,
      },
    })
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code
    if (code === "P2002") {
      return { ok: true, duplicate: true }
    }
    throw e
  }

  const findChallenge = getPrismaDelegateMethod(
    "worldCupBracketChallenge",
    "findUnique"
  )
  const challenge = findChallenge
    ? await findChallenge({
        where: { id: input.challengeId },
        select: { bracketLeagueId: true, ownerUserId: true },
      })
    : null

  if (challenge?.bracketLeagueId && challenge.ownerUserId) {
    await mirrorWorldCupEventToBracketPoolChat({
      leagueId: challenge.bracketLeagueId,
      actorUserId: challenge.ownerUserId,
      title: input.eventTitle,
      body: input.eventBody,
      eventType: input.eventType,
      challengeId: input.challengeId,
      metadata: input.metadata,
    })
  }

  return { ok: true }
}

async function mirrorWorldCupEventToBracketPoolChat(input: {
  leagueId: string
  actorUserId: string
  title: string
  body: string
  eventType: string
  challengeId: string
  metadata?: Record<string, unknown>
}) {
  const poolType: WorldCupPoolChatSystemKind = toPoolChatSystemType(input.eventType)
  const content = `${input.title}: ${input.body}`.slice(0, 480)
  const message = JSON.stringify({
    isSystem: true,
    type: poolType,
    content,
    worldCup: {
      challengeId: input.challengeId,
      eventType: input.eventType,
    },
  })

  const createMessage = getPrismaDelegateMethod("bracketLeagueMessage", "create")
  if (!createMessage) return

  await createMessage({
    data: {
      leagueId: input.leagueId,
      userId: input.actorUserId,
      message,
      type: "text",
      metadata: {
        worldCupChallengeId: input.challengeId,
        worldCupEventType: input.eventType,
        ...(input.metadata ?? {}),
      },
    },
  })
}

export function fireAndForgetEmit(promise: Promise<unknown>) {
  void promise.catch((err) => {
    console.warn("[world-cup/events] emit failed", err)
  })
}

export async function listWorldCupBracketChatEvents(
  challengeId: string,
  take = 40
) {
  const findMany = getPrismaDelegateMethod("worldCupBracketChatEvent", "findMany")
  if (!findMany) return []

  const rows = await findMany({
    where: { challengeId },
    orderBy: { createdAt: "desc" },
    take,
  })
  return Array.isArray(rows) ? rows.filter(isPublicWorldCupFeedEvent) : []
}

export function isPublicWorldCupFeedEvent(event: { metadata?: unknown; eventType?: string | null }) {
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown>
    : {}
  if (metadata.visibility === "private_to_user") return false
  if (metadata.messageType === "chimmy_private_prompt" || metadata.messageType === "chimmy_private_response") {
    return false
  }
  return event.eventType !== "world_cup.pool_chat_chimmy_private"
}
