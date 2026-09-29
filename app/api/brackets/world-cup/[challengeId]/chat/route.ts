import { randomUUID } from "crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import { prisma } from "@/lib/prisma"
import { BlockListUnavailableError, getBlockedSenderSetForRead } from "@/lib/moderation/BlockUserService"
import {
  getGifProviderName,
  isGifSearchConfigured,
  searchGifs,
} from "@/lib/rich-message/GIFIntegrationResolver"
import { rateLimitManager } from "@/lib/workers/rate-limit-manager"
import { createPlatformThread } from "@/lib/platform/chat-service"
import {
  isCloudinaryConfigured,
  isWorldCupChatImageType,
  uploadWorldCupChatImageToCloudinary,
  WORLD_CUP_CHAT_IMAGE_MAX_BYTES,
} from "@/lib/world-cup/worldCupChatImageUpload"
import { buildWorldCupChimmyContext, type WorldCupChimmyContext } from "@/lib/world-cup/worldCupChimmyContext"
import {
  ChimmyTokenSpendFailedError,
  generateWorldCupChimmyPrivateReply,
} from "@/lib/world-cup/worldCupChimmyPrivateReply"
import {
  prepareWorldCupAiTokenFallback,
  WORLD_CUP_AI_TOKEN_RULES,
  type WorldCupAiTokenAccess,
} from "@/lib/world-cup/worldCupAiTokenFallback"
import { checkWorldCupChimmyRateLimit } from "@/lib/world-cup/worldCupChimmyRateLimit"
import { getWcUpgradeMessage, resolveWcCapTier } from "@/lib/world-cup/worldCupAiUsageLimits"
import { tryDeterministicWorldCupChimmyReply } from "@/lib/world-cup/worldCupChimmyReplyPolicy"
import {
  getWorldCupNotificationPreferenceResolution,
  updateWorldCupNotificationPreferencesForUser,
} from "@/lib/world-cup/worldCupNotificationPreferences"
import {
  notifyWorldCupAllMention,
  notifyWorldCupChimmyReply,
  notifyWorldCupMention,
} from "@/lib/world-cup/worldCupNotifications"
import {
  parseWorldCupPoolMentions,
  WORLD_CUP_POOL_CHAT_EVENT_TYPES,
} from "@/lib/world-cup/worldCupPoolChatPlan"
import {
  assertWorldCupChallengeMemberOrManager,
  assertWorldCupManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"
import { resolveLanguage } from "@/lib/i18n/constants"

export const runtime = "nodejs"

// In-memory rate limiter for text messages: 5 per 10 s per user.
// Single-instance guard — adequate for Railway's default single-instance deploy.
const _textMsgTimestamps = new Map<string, number[]>()
const TEXT_MSG_WINDOW_MS = 10_000
const TEXT_MSG_BURST_MAX = 5
const _gifSearchTimestamps = new Map<string, number[]>()
const GIF_SEARCH_WINDOW_MS = 60_000
const GIF_SEARCH_BURST_MAX = 12
const WORLD_CUP_DEFAULT_GIF_QUERY = "world cup soccer"
const WORLD_CUP_GIF_CACHE_TTL_MS = 30 * 60 * 1000

function checkAndRecordTextMessageRate(userId: string): boolean {
  const now = Date.now()
  const prev = (_textMsgTimestamps.get(userId) ?? []).filter((t) => now - t < TEXT_MSG_WINDOW_MS)
  if (prev.length >= TEXT_MSG_BURST_MAX) return false
  _textMsgTimestamps.set(userId, [...prev, now])
  return true
}

function checkAndRecordGifSearchRate(userId: string): boolean {
  const now = Date.now()
  const prev = (_gifSearchTimestamps.get(userId) ?? []).filter((t) => now - t < GIF_SEARCH_WINDOW_MS)
  if (prev.length >= GIF_SEARCH_BURST_MAX) return false
  _gifSearchTimestamps.set(userId, [...prev, now])
  return true
}

const MAX_BODY_CHARS = 1000
const ALLOWED_GIF_PROVIDERS = ["klipy", "tenor", "giphy"] as const

const preferencePatchSchema = z.object({
  poolMuted: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  usernameMentionsEnabled: z.boolean().optional(),
  allMentionsEnabled: z.boolean().optional(),
  commissionerAnnouncementsEnabled: z.boolean().optional(),
  deadlineRemindersEnabled: z.boolean().optional(),
  bracketFinalizedEnabled: z.boolean().optional(),
  resultsUpdatedEnabled: z.boolean().optional(),
  leaderboardUpdatedEnabled: z.boolean().optional(),
  generalChatEnabled: z.boolean().optional(),
  chimmyRepliesEnabled: z.boolean().optional(),
  globalBroadcastEnabled: z.boolean().optional(),
})

const postSchema = z.object({
  action: z.enum(["send_message", "chimmy_private"]).optional(),
  body: z.string().trim().min(1).max(MAX_BODY_CHARS),
  /**
   * Set to true when the user has explicitly confirmed a token spend for a
   * Chimmy LLM coaching answer. Without this flag, non-subscribed users receive
   * a 409 token_confirmation_required response so the UI can show a cost preview.
   * Deterministic and cached answers ignore this flag — they are always free.
   */
  confirmedTokenSpend: z.boolean().optional().default(false),
  gif: z.object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().max(160).optional().default("GIF"),
    previewUrl: z.string().url().max(1000),
    gifUrl: z.string().url().max(1000),
    width: z.number().int().min(0).max(4000).optional().default(0),
    height: z.number().int().min(0).max(4000).optional().default(0),
    provider: z.enum(ALLOWED_GIF_PROVIDERS),
  }).optional(),
  image: z.object({
    assetId: z.string().trim().min(1).max(160),
    publicId: z.string().trim().min(1).max(300),
    secureUrl: z.string().url().max(1000),
    width: z.number().int().min(0).max(8000).optional().default(0),
    height: z.number().int().min(0).max(8000).optional().default(0),
    format: z.string().trim().min(1).max(24),
    bytes: z.number().int().min(1).max(5 * 1024 * 1024),
    provider: z.literal("cloudinary"),
  }).optional(),
})

const startDmSchema = z.object({
  action: z.literal("start_dm"),
  memberUserIds: z.array(z.string().trim().min(1)).min(1).max(12),
  title: z.string().trim().min(1).max(100).optional(),
})

const postActionSchema = z.object({
  action: z.string().trim().optional(),
}).passthrough()

const createPollSchema = z.object({
  action: z.literal("create_poll"),
  question: z.string().trim().min(1).max(180),
  options: z.array(z.string().trim().max(80)).min(2).max(6),
})

const pollVoteSchema = z.object({
  action: z.literal("poll_vote"),
  messageId: z.string().trim().min(1),
  optionId: z.string().trim().min(1).max(80),
})

type RawWorldCupChatEvent = {
  id: string
  challengeId: string
  userId: string | null
  eventType: string
  eventTitle: string
  eventBody: string
  metadata: Record<string, unknown> | null
  createdAt: Date
  isAiGenerated: boolean
  user?: {
    displayName?: string | null
    username?: string | null
    avatarUrl?: string | null
  } | null
}

type WorldCupChallengeSummary = {
  id: string
  name?: string | null
}

type WorldCupChatMemberRow = {
  userId: string
  displayName: string
  joinedAt: Date
  user?: {
    id: string
    username?: string | null
    displayName?: string | null
    avatarUrl?: string | null
  } | null
}

type UploadedImageFile = Blob & { name?: string; arrayBuffer: () => Promise<ArrayBuffer> }

function isUploadedImageFile(value: unknown): value is UploadedImageFile {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
      typeof (value as { size?: unknown }).size === "number"
  )
}

function inferImageMimeType(file: UploadedImageFile) {
  const declared = file.type || ""
  if (declared && declared !== "application/octet-stream") return declared
  const name = typeof (file as File).name === "string" ? (file as File).name.toLowerCase() : ""
  if (name.endsWith(".png")) return "image/png"
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg"
  if (name.endsWith(".webp")) return "image/webp"
  if (name.endsWith(".gif")) return "image/gif"
  return declared || "application/octet-stream"
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isAllowedGifUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:") return false
    const host = url.hostname.toLowerCase()
    return host.includes("klipy") ||
      host.includes("giphy") ||
      host.includes("tenor") ||
      host.includes("gstatic") ||
      host.includes("media")
  } catch {
    return false
  }
}

function gifMetadata(value: unknown) {
  const metadata = metadataObject(value)
  const provider = typeof metadata.provider === "string" ? metadata.provider : null
  const gifUrl = typeof metadata.gifUrl === "string" ? metadata.gifUrl : null
  const previewUrl = typeof metadata.previewUrl === "string" ? metadata.previewUrl : null
  if (!provider || !gifUrl || !previewUrl) return null
  return {
    id: typeof metadata.id === "string" ? metadata.id : "gif",
    title: typeof metadata.title === "string" ? metadata.title : "GIF",
    previewUrl,
    gifUrl,
    width: typeof metadata.width === "number" ? metadata.width : 0,
    height: typeof metadata.height === "number" ? metadata.height : 0,
    provider,
  }
}

function imageMetadata(value: unknown) {
  const metadata = metadataObject(value)
  const provider = metadata.provider === "cloudinary" ? "cloudinary" : null
  const secureUrl = typeof metadata.secureUrl === "string" ? metadata.secureUrl : null
  const publicId = typeof metadata.publicId === "string" ? metadata.publicId : null
  if (!provider || !secureUrl || !publicId) return null
  return {
    assetId: typeof metadata.assetId === "string" ? metadata.assetId : "",
    publicId,
    secureUrl,
    width: typeof metadata.width === "number" ? metadata.width : 0,
    height: typeof metadata.height === "number" ? metadata.height : 0,
    format: typeof metadata.format === "string" ? metadata.format : "",
    bytes: typeof metadata.bytes === "number" ? metadata.bytes : 0,
    provider,
  }
}

function isAllowedCloudinaryImageUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && /(^|\.)res\.cloudinary\.com$/i.test(url.hostname)
  } catch {
    return false
  }
}

function sanitizeGifQuery(value: string | null) {
  return (value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 64)
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function worldCupGifCacheKey(query: string, limit: number) {
  return `world-cup-chat:gifs:${query.toLowerCase()}:${limit}`
}

function parseCachedGifs(value: unknown) {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const gifs = Array.isArray(data.gifs) ? data.gifs : []
  return gifs
    .map((gif) => metadataObject(gif))
    .map((gif) => ({
      id: typeof gif.id === "string" ? gif.id : "",
      title: typeof gif.title === "string" ? gif.title : "GIF",
      previewUrl: typeof gif.previewUrl === "string" ? gif.previewUrl : "",
      gifUrl: typeof gif.gifUrl === "string" ? gif.gifUrl : "",
      width: safeNumber(gif.width),
      height: safeNumber(gif.height),
      provider: gif.provider,
    }))
    .filter((gif) => gif.id && gif.previewUrl && gif.gifUrl && ALLOWED_GIF_PROVIDERS.includes(gif.provider as any))
}

async function readCachedWorldCupGifs(cacheKey: string) {
  try {
    const row = await (prisma as any).sportsDataCache.findUnique({
      where: { cacheKey },
      select: { data: true, expiresAt: true },
    })
    if (!row || new Date(row.expiresAt).getTime() <= Date.now()) return null
    return parseCachedGifs(row.data)
  } catch {
    return null
  }
}

async function writeCachedWorldCupGifs(cacheKey: string, gifs: unknown[]) {
  try {
    await (prisma as any).sportsDataCache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        data: { gifs },
        expiresAt: new Date(Date.now() + WORLD_CUP_GIF_CACHE_TTL_MS),
      },
      update: {
        data: { gifs },
        expiresAt: new Date(Date.now() + WORLD_CUP_GIF_CACHE_TTL_MS),
      },
    })
  } catch {
    // GIF cache misses should never break chat.
  }
}

function sanitizePollText(value: string, maxLength: number) {
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

function normalizePollOptions(values: string[]) {
  const options = values
    .map((value) => sanitizePollText(value, 80))
    .filter(Boolean)

  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const option of options) {
    const key = option.toLowerCase()
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }

  return {
    options,
    hasDuplicates: duplicates.size > 0,
  }
}

function pollMetadata(value: unknown, requesterUserId: string) {
  const metadata = metadataObject(value)
  const question = typeof metadata.question === "string" ? metadata.question : null
  const rawOptions = Array.isArray(metadata.options) ? metadata.options : []
  const rawVotes = Array.isArray(metadata.votes) ? metadata.votes : []
  if (!question || rawOptions.length === 0) return null

  const options = rawOptions
    .map((option) => metadataObject(option))
    .map((option) => ({
      id: typeof option.id === "string" ? option.id : "",
      label: typeof option.label === "string" ? option.label : "",
    }))
    .filter((option) => option.id && option.label)
  if (options.length === 0) return null

  const validOptionIds = new Set(options.map((option) => option.id))
  const votes = rawVotes
    .map((vote) => metadataObject(vote))
    .map((vote) => ({
      userId: typeof vote.userId === "string" ? vote.userId : "",
      optionId: typeof vote.optionId === "string" ? vote.optionId : "",
      votedAt: typeof vote.votedAt === "string" ? vote.votedAt : "",
    }))
    .filter((vote) => vote.userId && validOptionIds.has(vote.optionId))

  const voteCounts = Object.fromEntries(options.map((option) => [option.id, 0])) as Record<string, number>
  for (const vote of votes) {
    voteCounts[vote.optionId] = (voteCounts[vote.optionId] ?? 0) + 1
  }
  const totalVotes = votes.length
  const currentUserVote = votes.find((vote) => vote.userId === requesterUserId)?.optionId ?? null
  const closedAt = typeof metadata.closedAt === "string" ? metadata.closedAt : null
  const enrichedOptions = options.map((option) => {
    const votesForOption = voteCounts[option.id] ?? 0
    return {
      ...option,
      votes: votesForOption,
      percentage: totalVotes > 0 ? Math.round((votesForOption / totalVotes) * 100) : 0,
    }
  })

  return {
    question,
    options: enrichedOptions,
    currentUserVote,
    totalVotes,
    closed: Boolean(closedAt),
    closedAt,
    createdByUserId: typeof metadata.createdByUserId === "string" ? metadata.createdByUserId : null,
    createdAt: typeof metadata.createdAt === "string" ? metadata.createdAt : null,
  }
}

function serializeChatMessage(row: RawWorldCupChatEvent, requesterUserId: string) {
  const metadata = metadataObject(row.metadata)
  const visibility = typeof metadata.visibility === "string" ? metadata.visibility : "public"
  const targetUserId = typeof metadata.targetUserId === "string" ? metadata.targetUserId : null
  const authorNameOverride = typeof metadata.authorName === "string" ? metadata.authorName : null
  /*
   * 🛑 NEVER A NAME FROM AN EMAIL. This fell back to the part before the "@" of the author's email,
   * and the result went to every member of the pool — for anyone with no display name or username,
   * their email prefix was their name in chat (found 2026-09-29). The bracket pool chat route found
   * and fixed the same leak on 2026-09-25. Email is no longer even selected for these rows.
   */
  const displayName =
    authorNameOverride ||
    row.user?.displayName ||
    row.user?.username ||
    (row.isAiGenerated ? "Chimmy" : null) ||
    (row.userId === requesterUserId ? "You" : "Pool member")

  // Freshness chip data — only set on AI/Chimmy messages, null on user messages
  const dataSourceTier = typeof metadata.dataSourceTier === "string" ? metadata.dataSourceTier : null
  const dataSourceDisplay = typeof metadata.dataSourceDisplay === "string" ? metadata.dataSourceDisplay : null

  // Billing transparency hint — only set on AI/Chimmy messages
  const billingHint = typeof metadata.billingDisplayHint === "string" ? metadata.billingDisplayHint : null

  return {
    id: row.id,
    challengeId: row.challengeId,
    userId: row.userId,
    authorName: displayName,
    authorAvatarUrl: row.user?.avatarUrl ?? null,
    body: row.eventBody,
    messageType: metadata.messageType ?? "text",
    gif: gifMetadata(metadata.gif),
    image: imageMetadata(metadata.image),
    poll: pollMetadata(metadata.poll, requesterUserId),
    visibility,
    targetUserId,
    mentions: Array.isArray(metadata.mentions) ? metadata.mentions : [],
    createdAt: row.createdAt.toISOString(),
    isOwnMessage: row.userId === requesterUserId,
    isPrivate: visibility === "private_to_user",
    dataSourceTier,
    dataSourceDisplay,
    billingHint,
  }
}

async function listChatMessages(challengeId: string, requesterUserId: string) {
  const rows = await (prisma as any).worldCupBracketChatEvent.findMany({
    where: {
      challengeId,
      eventType: {
        in: [
          WORLD_CUP_POOL_CHAT_EVENT_TYPES.TEXT_MESSAGE,
          WORLD_CUP_POOL_CHAT_EVENT_TYPES.CHIMMY_PRIVATE,
          WORLD_CUP_POOL_CHAT_EVENT_TYPES.POLL,
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  }) as RawWorldCupChatEvent[]

  return rows
    .filter((row) => {
      const metadata = metadataObject(row.metadata)
      const visibility = metadata.visibility
      const targetUserId = typeof metadata.targetUserId === "string" ? metadata.targetUserId : null
      if (visibility !== "private_to_user") return true
      return row.userId === requesterUserId || targetUserId === requesterUserId
    })
    .reverse()
    .map((row) => serializeChatMessage(row, requesterUserId))
}

async function searchWorldCupChatGifs(request: Request, userId: string) {
  const url = new URL(request.url)
  const q = sanitizeGifQuery(url.searchParams.get("q")) || WORLD_CUP_DEFAULT_GIF_QUERY

  if (!isGifSearchConfigured()) {
    return NextResponse.json({
      gifs: [],
      total: 0,
      disabled: true,
      message: "GIF search is not configured yet.",
    })
  }

  if (!checkAndRecordGifSearchRate(userId)) {
    return NextResponse.json(
      { gifs: [], total: 0, error: "Too many GIF searches. Please wait a minute." },
      { status: 429 }
    )
  }

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 12), 1), 24)
  const cacheKey = worldCupGifCacheKey(q, limit)
  const cached = await readCachedWorldCupGifs(cacheKey)
  if (cached) {
    const provider = getGifProviderName()
    if (provider) {
      await rateLimitManager.recordCall(provider, "world_cup:gifs", 200, 0, { cached: true })
    }
    return NextResponse.json({ gifs: cached, total: cached.length, cached: true, query: q })
  }

  const started = Date.now()
  const provider = getGifProviderName()
  const results = await searchGifs(q, limit)
  const gifs = results.map((gif) => ({
    id: gif.id,
    title: "GIF",
    previewUrl: gif.previewUrl ?? gif.url,
    gifUrl: gif.url,
    width: safeNumber((gif as { width?: unknown }).width),
    height: safeNumber((gif as { height?: unknown }).height),
    provider: gif.provider,
  }))
  await writeCachedWorldCupGifs(cacheKey, gifs)
  if (provider) {
    await rateLimitManager.recordCall(provider, "world_cup:gifs", 200, Date.now() - started)
  }

  return NextResponse.json({ gifs, total: gifs.length, cached: false, query: q })
}

async function getNotificationPreferences(userId: string, challengeId: string) {
  const resolution = await getWorldCupNotificationPreferenceResolution(userId, challengeId)
  return NextResponse.json({
    preferences: resolution.preferences,
    phoneVerified: resolution.phoneVerified,
    phoneVerificationRequiredForSms: true,
  })
}

async function updateNotificationPreferences(
  userId: string,
  challengeId: string,
  patch: unknown
) {
  const parsed = preferencePatchSchema.safeParse(patch)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid preferences", issues: parsed.error.flatten() }, { status: 400 })
  }

  const result = await updateWorldCupNotificationPreferencesForUser({
    userId,
    challengeId,
    patch: parsed.data,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Failed to save preferences" }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    preferences: result.preferences,
    phoneVerificationRequiredForSms: true,
  })
}

async function uploadWorldCupImage(request: Request, challengeId: string, userId: string) {
  if (!isCloudinaryConfigured()) {
    return NextResponse.json({
      error: "Cloudinary image uploads are not configured.",
      code: "WORLD_CUP_CLOUDINARY_NOT_CONFIGURED",
      requiredEnv: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
    }, { status: 501 })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 })
  }

  const file = formData.get("file")
  if (!isUploadedImageFile(file)) {
    return NextResponse.json({ error: "Image file required" }, { status: 400 })
  }

  const mimeType = inferImageMimeType(file)
  if (!isWorldCupChatImageType(mimeType)) {
    return NextResponse.json({ error: "Only PNG, JPEG, WebP, and GIF images are allowed" }, { status: 400 })
  }

  const actualBytes = (await file.arrayBuffer()).byteLength
  if (file.size > WORLD_CUP_CHAT_IMAGE_MAX_BYTES || actualBytes > WORLD_CUP_CHAT_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 400 })
  }

  try {
    const image = await uploadWorldCupChatImageToCloudinary({
      file,
      challengeId,
      userId,
    })
    return NextResponse.json({ image })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Image upload failed",
    }, { status: 500 })
  }
}

async function createWorldCupPoll(input: {
  challengeId: string
  userId: string
  payload: unknown
}) {
  const parsed = createPollSchema.safeParse(input.payload)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid poll", issues: parsed.error.flatten() }, { status: 400 })
  }

  const question = sanitizePollText(parsed.data.question, 180)
  const normalized = normalizePollOptions(parsed.data.options)
  if (!question) {
    return NextResponse.json({ error: "Poll question is required." }, { status: 400 })
  }
  if (normalized.options.length < 2 || normalized.options.length > 6) {
    return NextResponse.json({ error: "Polls require 2 to 6 options." }, { status: 400 })
  }
  if (normalized.hasDuplicates) {
    return NextResponse.json({ error: "Poll options must be unique." }, { status: 400 })
  }

  const createdAt = new Date().toISOString()
  const options = normalized.options.map((label, index) => ({
    id: `option-${index + 1}`,
    label,
  }))

  const created = await (prisma as any).worldCupBracketChatEvent.create({
    data: {
      challengeId: input.challengeId,
      userId: input.userId,
      eventType: WORLD_CUP_POOL_CHAT_EVENT_TYPES.POLL,
      eventTitle: "Pool poll",
      eventBody: question,
      idempotencyKey: `poll:${input.userId}:${randomUUID()}`,
      isAiGenerated: false,
      metadata: {
        messageType: "poll",
        poll: {
          question,
          options,
          votes: [],
          createdByUserId: input.userId,
          createdAt,
          closedAt: null,
        },
        visibility: "public",
        targetUserId: null,
        mentions: [],
        mentionedUserIds: [],
      },
    },
    include: {
      user: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  }) as RawWorldCupChatEvent

  return NextResponse.json({ ok: true, message: serializeChatMessage(created, input.userId) }, { status: 201 })
}

async function voteWorldCupPoll(input: {
  challengeId: string
  userId: string
  payload: unknown
}) {
  const parsed = pollVoteSchema.safeParse(input.payload)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid poll vote", issues: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await (prisma as any).worldCupBracketChatEvent.findFirst({
    where: {
      id: parsed.data.messageId,
      challengeId: input.challengeId,
      eventType: WORLD_CUP_POOL_CHAT_EVENT_TYPES.POLL,
    },
    include: {
      user: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  }) as RawWorldCupChatEvent | null

  if (!existing) {
    return NextResponse.json({ error: "Poll not found." }, { status: 404 })
  }

  const metadata = metadataObject(existing.metadata)
  const rawPoll = metadataObject(metadata.poll)
  if (metadata.messageType !== "poll" || !rawPoll.question) {
    return NextResponse.json({ error: "Message is not a poll." }, { status: 400 })
  }
  if (typeof rawPoll.closedAt === "string" && rawPoll.closedAt) {
    return NextResponse.json({ error: "Poll is closed." }, { status: 409 })
  }

  const rawOptions = Array.isArray(rawPoll.options) ? rawPoll.options : []
  const options = rawOptions.map((option) => metadataObject(option))
  const hasOption = options.some((option) => option.id === parsed.data.optionId)
  if (!hasOption) {
    return NextResponse.json({ error: "Invalid poll option." }, { status: 400 })
  }

  const previousVotes = Array.isArray(rawPoll.votes) ? rawPoll.votes : []
  const votes = previousVotes
    .map((vote) => metadataObject(vote))
    .filter((vote) => vote.userId && vote.userId !== input.userId)
  votes.push({
    userId: input.userId,
    optionId: parsed.data.optionId,
    votedAt: new Date().toISOString(),
  })

  const updatedMetadata = {
    ...metadata,
    poll: {
      ...rawPoll,
      votes,
    },
  }

  const updated = await (prisma as any).worldCupBracketChatEvent.update({
    where: { id: existing.id },
    data: { metadata: updatedMetadata },
    include: {
      user: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  }) as RawWorldCupChatEvent

  const message = serializeChatMessage(updated, input.userId)
  return NextResponse.json({ ok: true, message, poll: message.poll })
}

async function resolveMentionedUsers(challengeId: string, names: string[]) {
  const normalizedNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
  if (normalizedNames.length === 0) return []

  const participants = await (prisma as any).worldCupBracketParticipant.findMany({
    where: {
      challengeId,
      OR: normalizedNames.flatMap((name) => [
        { displayName: { equals: name, mode: "insensitive" } },
        { user: { username: { equals: name, mode: "insensitive" } } },
      ]),
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
        },
      },
    },
  }) as Array<{
    userId: string
    displayName: string
    user?: { id: string; username?: string | null; displayName?: string | null } | null
  }>

  return participants.map((participant) => ({
    userId: participant.userId,
    label: participant.user?.username ?? participant.displayName,
  }))
}

async function listWorldCupChatMembers(challengeId: string, requesterUserId: string) {
  const participants = await (prisma as any).worldCupBracketParticipant.findMany({
    where: { challengeId },
    orderBy: [{ rank: "asc" }, { joinedAt: "asc" }],
    take: 100,
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  }) as WorldCupChatMemberRow[]

  return participants.map((participant) => {
    const user = participant.user
    const username = user?.username ?? null
    /* Never a name from an email — see serializeChatMessage. This list goes to every member. */
    const label =
      user?.displayName ||
      username ||
      participant.displayName ||
      "Pool member"
    return {
      userId: participant.userId,
      username,
      displayName: label,
      avatarUrl: user?.avatarUrl ?? null,
      joinedAt: participant.joinedAt.toISOString(),
      isCurrentUser: participant.userId === requesterUserId,
    }
  })
}

async function startWorldCupDmThread(input: {
  challengeId: string
  userId: string
  payload: unknown
}) {
  const parsed = startDmSchema.safeParse(input.payload)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid DM request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const requestedMembers = Array.from(new Set(parsed.data.memberUserIds.filter((id) => id !== input.userId)))
  if (requestedMembers.length === 0) {
    return NextResponse.json({ error: "Choose at least one other pool member." }, { status: 400 })
  }

  const rows = await (prisma as any).worldCupBracketParticipant.findMany({
    where: {
      challengeId: input.challengeId,
      userId: { in: requestedMembers },
    },
    select: { userId: true },
  }) as Array<{ userId: string }>
  const allowed = new Set(rows.map((row) => row.userId))
  const allMembersAreInPool = requestedMembers.every((userId) => allowed.has(userId))
  if (!allMembersAreInPool) {
    return NextResponse.json({ error: "Direct messages can only include members of this World Cup pool." }, { status: 403 })
  }

  const thread = await createPlatformThread({
    creatorUserId: input.userId,
    threadType: requestedMembers.length === 1 ? "dm" : "group",
    productType: "bracket",
    title: requestedMembers.length === 1
      ? undefined
      : parsed.data.title ?? "World Cup private chat",
    memberUserIds: requestedMembers,
  })

  if (!thread) {
    return NextResponse.json({ error: "Unable to start private chat." }, { status: 400 })
  }

  return NextResponse.json({ ok: true, thread }, { status: 201 })
}

async function getWorldCupChallengeSummary(challengeId: string): Promise<WorldCupChallengeSummary | null> {
  try {
    const delegate = (prisma as any).worldCupBracketChallenge
    if (!delegate?.findUnique) return null
    return await delegate.findUnique({
      where: { id: challengeId },
      select: { id: true, name: true },
    }) as WorldCupChallengeSummary | null
  } catch {
    return null
  }
}

async function createPrivateChimmyResponse(input: {
  challengeId: string
  userId: string
  prompt: string
  promptMessage: RawWorldCupChatEvent
  locale?: string | null
  context?: WorldCupChimmyContext | null
  userRole?: WorldCupChimmyContext["userRole"]
  deterministicOnly?: boolean
  /** Subscription plan for billing decision — "pro" for subscribed users, null for free. */
  entitlements?: { plan?: string | null }
  /**
   * Callback to commit a token spend after a successful validated LLM response.
   * Null for subscription-covered and deterministic paths. If provided and the spend
   * fails after a valid LLM response, throws ChimmyTokenSpendFailedError.
   */
  commitTokenSpend?: (() => Promise<unknown>) | null
}) {
  // Build rich context and challenge summary in parallel — neither is blocking.
  const [challenge, context] = await Promise.all([
    getWorldCupChallengeSummary(input.challengeId),
    input.context !== undefined
      ? Promise.resolve(input.context)
      : buildWorldCupChimmyContext({
      challengeId: input.challengeId,
      userId: input.userId,
      locale: input.locale,
      userRole: input.userRole,
    }).catch(() => null), // swallow — context is best-effort, chat must not fail
  ])
  const ai = await generateWorldCupChimmyPrivateReply({
    userId: input.userId,
    challengeId: input.challengeId,
    prompt: input.prompt,
    challengeName: challenge?.name ?? null,
    locale: input.locale,
    context,
    userRole: input.userRole,
    deterministicOnly: input.deterministicOnly,
    entitlements: input.entitlements,
    commitTokenSpend: input.commitTokenSpend ?? null,
  })

  const response = await (prisma as any).worldCupBracketChatEvent.create({
    data: {
      challengeId: input.challengeId,
      userId: null,
      eventType: WORLD_CUP_POOL_CHAT_EVENT_TYPES.CHIMMY_PRIVATE,
      eventTitle: "Private Chimmy reply",
      eventBody: ai.reply,
      idempotencyKey: `chimmy-reply:${input.userId}:${randomUUID()}`,
      isAiGenerated: true,
      metadata: {
        messageType: "chimmy_private_response",
        visibility: "private_to_user",
        targetUserId: input.userId,
        promptMessageId: input.promptMessage.id,
        conversationId: ai.conversationId,
        provider: ai.provider,
        model: ai.model,
        groundingIntent: ai.grounding?.prompt.intent.category,
        groundingConfidence: ai.grounding?.dataQuality.confidence,
        noChargeReason: ai.grounding?.dataQuality.noChargeReason,
        /** Freshness chip — read by the UI to show "Pool data" / "Live" / "Cached" badge */
        dataSourceTier: ai.sourceFreshness?.tier ?? "pool_only",
        dataSourceDisplay: ai.sourceFreshness?.shortDisplay ?? "Pool data",
        /** Token billing decision — surfaced in the UI bubble for transparency */
        billingReason: ai.billingDecision.reason,
        billingDisplayHint: ai.billingDecision.displayHint,
        shouldChargeToken: ai.billingDecision.shouldChargeToken,
        authorName: "Chimmy",
        source: "world_cup_pool_chat",
      },
    },
    include: {
      user: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  }) as RawWorldCupChatEvent

  return response
}

export async function GET(
  request: Request,
  context: { params: { challengeId: string } }
) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupChallengeMemberOrManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const url = new URL(request.url)
  const action = url.searchParams.get("action")
  if (action === "gifs") {
    return searchWorldCupChatGifs(request, auth.user.id)
  }
  if (action === "notification_preferences") {
    return getNotificationPreferences(auth.user.id, params.data.challengeId)
  }
  if (action === "members") {
    const members = await listWorldCupChatMembers(params.data.challengeId, auth.user.id)
    return NextResponse.json({ members })
  }

  /*
   * People this viewer blocked are not shown (App Store guideline 1.2), and a failed block-list read
   * is a 503, never an unfiltered pool chat — the rule every other chat read follows. Author-less
   * rows are never filtered, and the viewer is never in their own block set.
   */
  let blocked: Set<string>
  try {
    blocked = await getBlockedSenderSetForRead(auth.user.id)
  } catch (err) {
    if (!(err instanceof BlockListUnavailableError)) throw err
    return NextResponse.json({ error: "Messages are temporarily unavailable. Try again in a moment." }, { status: 503 })
  }
  const messages = (await listChatMessages(params.data.challengeId, auth.user.id)).filter(
    (m) => !m.userId || !blocked.has(m.userId),
  )
  /* `viewerUserId`: the shell offers Report and Block on everyone's messages but the viewer's own. */
  return NextResponse.json({ messages, viewerUserId: auth.user.id })
}

export async function POST(
  request: Request,
  context: { params: { challengeId: string } }
) {
  const auth = await requireWorldCupApiUser(request)
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse(context.params)
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupChallengeMemberOrManager(request, params.data.challengeId, auth.user)
  if (!access.ok) return access.response

  const url = new URL(request.url)
  const queryAction = url.searchParams.get("action")
  if (queryAction === "upload_image") {
    return uploadWorldCupImage(request, params.data.challengeId, auth.user.id)
  }

  if (
    queryAction &&
    queryAction !== "update_notification_preferences" &&
    queryAction !== "send_message" &&
    queryAction !== "chimmy_private" &&
    queryAction !== "create_poll" &&
    queryAction !== "poll_vote" &&
    queryAction !== "start_dm"
  ) {
    return NextResponse.json({ error: "Unknown World Cup chat action" }, { status: 400 })
  }

  const json = await request.json().catch(() => ({}))
  const action = queryAction ?? postActionSchema.parse(json).action
  if (action === "update_notification_preferences") {
    return updateNotificationPreferences(auth.user.id, params.data.challengeId, json)
  }
  if (action === "create_poll") {
    return createWorldCupPoll({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      payload: json,
    })
  }
  if (action === "poll_vote") {
    return voteWorldCupPoll({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      payload: json,
    })
  }
  if (action === "start_dm") {
    return startWorldCupDmThread({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      payload: json,
    })
  }
  if (action && action !== "send_message" && action !== "chimmy_private") {
    return NextResponse.json({ error: "Unknown World Cup chat action" }, { status: 400 })
  }

  const parsed = postSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid message", issues: parsed.error.flatten() }, { status: 400 })
  }

  const body = parsed.data.body
  const gif = parsed.data.gif
  const image = parsed.data.image
  if (gif && (!isAllowedGifUrl(gif.previewUrl) || !isAllowedGifUrl(gif.gifUrl))) {
    return NextResponse.json({ error: "Invalid GIF provider URL" }, { status: 400 })
  }
  if (image && !isAllowedCloudinaryImageUrl(image.secureUrl)) {
    return NextResponse.json({ error: "Invalid Cloudinary image URL" }, { status: 400 })
  }
  const mentions = parseWorldCupPoolMentions(body)
  const hasGlobal = mentions.some((mention) => mention.type === "global")
  const hasAll = mentions.some((mention) => mention.type === "all")
  const hasChimmy = action === "chimmy_private" || mentions.some((mention) => mention.type === "chimmy")
  let chimmyLocale: string | null = null
  let chimmyContext: WorldCupChimmyContext | null | undefined
  const chimmyUserRole: WorldCupChimmyContext["userRole"] =
    access.isAdmin ? "admin" : access.challenge ? "commissioner" : "participant"
  let deterministicOnlyChimmy = false
  // Token access resolved in the hasChimmy block; used when calling createPrivateChimmyResponse.
  let chimmyTokenAccess: WorldCupAiTokenAccess | null = null
  // Whether this user has subscription AI entitlement (for billing hint in audit log).
  let chimmyHasAi = false

  if (hasGlobal) {
    const manager = await assertWorldCupManager(request, params.data.challengeId, auth.user)
    if (!manager.ok) {
      return NextResponse.json({ error: "@global is commissioner-only." }, { status: 403 })
    }
    return NextResponse.json({
      error: "@global World Cup broadcast is coming soon.",
      code: "WORLD_CUP_GLOBAL_BROADCAST_COMING_SOON",
    }, { status: 409 })
  }

  if (hasAll) {
    const manager = await assertWorldCupManager(request, params.data.challengeId, auth.user)
    if (!manager.ok) {
      return NextResponse.json({ error: "@all is commissioner-only for World Cup pools." }, { status: 403 })
    }
  }

  if (hasChimmy) {
    const cookieStore = await cookies()
    chimmyLocale = resolveLanguage(cookieStore.get("af_lang")?.value)
    chimmyContext = await buildWorldCupChimmyContext({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      locale: chimmyLocale,
      userRole: chimmyUserRole,
    }).catch(() => null)
    const deterministicPreview = tryDeterministicWorldCupChimmyReply({
      prompt: body.replace(/(^|[\s*_~\]])@chimmy\b/gi, "$1"),
      context: chimmyContext,
      locale: chimmyLocale,
    })
    if (deterministicPreview) {
      deterministicOnlyChimmy = true
    }

    // Check subscription entitlement — only needed for the LLM path.
    const hasAi = deterministicOnlyChimmy
      ? false
      : await userHasBracketBrainAi(auth.user.id, auth.user.email ?? null)
    chimmyHasAi = hasAi

    if (!deterministicOnlyChimmy) {
      // ── Token access gate ───────────────────────────────────────────────────
      // Subscribed users and platform admins: token check is bypassed (entitled = true).
      // Free users: must either confirm a 1-token spend or receive a 409 preview first.
      // Deterministic answers always bypass this block — they are never charged.
      const entitled = hasAi || access.isAdmin
      chimmyTokenAccess = await prepareWorldCupAiTokenFallback({
        userId: auth.user.id,
        userEmail: auth.user.email ?? null,
        entitled,
        ruleCode: WORLD_CUP_AI_TOKEN_RULES.chimmyCoaching,
        confirmTokenSpend: parsed.data.confirmedTokenSpend ?? false,
        sourceType: "world_cup_chimmy_coaching",
        sourceId: params.data.challengeId,
        idempotencyKey: `chimmy-coaching:${auth.user.id}:${randomUUID()}`,
        description: "World Cup Chimmy AI coaching answer",
        metadata: { challengeId: params.data.challengeId },
        upgradePath: "/pricing?from=wc-chimmy",
      })
      if (!chimmyTokenAccess.ok) {
        return chimmyTokenAccess.response
      }

      // Per-user per-UTC-day cost control. Tier-aware: admin 75/day, pro 30/day.
      const chimmyTier = resolveWcCapTier({ isAdmin: access.isAdmin, hasPro: hasAi })
      const rateLimit = await checkWorldCupChimmyRateLimit(auth.user.id, new Date(), chimmyTier)
      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error: "daily_ai_limit_reached",
            message: getWcUpgradeMessage("chimmy", chimmyTier),
            used: rateLimit.used,
            limit: rateLimit.limit,
            upgradePath: chimmyTier === "free" ? "/pricing?from=wc-chimmy" : "/pricing",
          },
          { status: 429 }
        )
      }
    }
  }

  // @all is already commissioner-gated above; skip burst limit for announcements.
  if (!hasChimmy && !hasAll && !checkAndRecordTextMessageRate(auth.user.id)) {
    return NextResponse.json(
      { error: "Too many messages. Please slow down." },
      { status: 429 }
    )
  }

  const usernameMentions = mentions
    .filter((mention) => mention.type === "username")
    .map((mention) => mention.value)
  const resolvedMentions = await resolveMentionedUsers(params.data.challengeId, usernameMentions)

  const visibility = hasChimmy ? "private_to_user" : "public"
  const eventType = hasChimmy
    ? WORLD_CUP_POOL_CHAT_EVENT_TYPES.CHIMMY_PRIVATE
    : WORLD_CUP_POOL_CHAT_EVENT_TYPES.TEXT_MESSAGE

  const promptMessageType = hasChimmy ? "chimmy_private_prompt" : null
  const created = await (prisma as any).worldCupBracketChatEvent.create({
    data: {
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      eventType,
      eventTitle: hasChimmy ? "Private Chimmy prompt" : "Pool chat",
      eventBody: body,
      idempotencyKey: `chat:${auth.user.id}:${randomUUID()}`,
      isAiGenerated: false,
      metadata: {
        messageType: promptMessageType ?? (image ? "image" : gif ? "gif" : "text"),
        gif: gif ? {
          id: gif.id,
          title: gif.title,
          previewUrl: gif.previewUrl,
          gifUrl: gif.gifUrl,
          width: gif.width,
          height: gif.height,
          provider: gif.provider,
        } : null,
        image: image ? {
          assetId: image.assetId,
          publicId: image.publicId,
          secureUrl: image.secureUrl,
          width: image.width,
          height: image.height,
          format: image.format,
          bytes: image.bytes,
          provider: image.provider,
        } : null,
        visibility,
        targetUserId: hasChimmy ? auth.user.id : null,
        mentions,
        mentionedUserIds: resolvedMentions.map((mention) => mention.userId),
        source: hasChimmy ? "world_cup_pool_chat" : null,
        notificationPreferenceTodo: "respect_world_cup_pool_chat_preferences_before_email_sms_push",
      },
    },
    include: {
      user: {
        select: {
          displayName: true,
          username: true,
          avatarUrl: true,
        },
      },
    },
  }) as RawWorldCupChatEvent

  const message = serializeChatMessage(created, auth.user.id)
  let chimmyResponseMessage: ReturnType<typeof serializeChatMessage> | null = null
  if (hasChimmy) {
    // Derive billing entitlements from the subscription check above.
    // "pro" is used as the plan signal for all subscribed users — the billing decision
    // only needs to know paid vs unpaid, not the exact plan tier.
    const chimmyEntitlements = chimmyHasAi || access.isAdmin
      ? { plan: "pro" as const }
      : undefined

    // commitTokenSpend is non-null only for the token-path (non-subscribed + confirmed).
    // For subscription users and deterministic paths it is null — safe to pass always.
    const commitTokenSpend = chimmyTokenAccess?.ok
      ? chimmyTokenAccess.commitTokenSpend
      : null

    let response: RawWorldCupChatEvent
    try {
      response = await createPrivateChimmyResponse({
        challengeId: params.data.challengeId,
        userId: auth.user.id,
        prompt: body,
        promptMessage: created,
        locale: chimmyLocale,
        context: chimmyContext,
        userRole: chimmyUserRole,
        deterministicOnly: deterministicOnlyChimmy,
        entitlements: chimmyEntitlements,
        commitTokenSpend,
      })
    } catch (err) {
      if (err instanceof ChimmyTokenSpendFailedError) {
        // The LLM ran and passed validation, but token deduction failed.
        // Do not return the AI message — the user should retry once their balance
        // issue is resolved. The audit log already has tokenChargeStatus=spend_failed.
        return NextResponse.json(
          {
            error: "Your Chimmy answer was generated but the token could not be deducted. Please check your balance and try again.",
            code: err.code,
            promptMessageId: created.id,
          },
          { status: 402 }
        )
      }
      throw err
    }
    chimmyResponseMessage = serializeChatMessage(response, auth.user.id)
  }
  if (!hasChimmy && resolvedMentions.length > 0) {
    await notifyWorldCupMention({
      challengeId: params.data.challengeId,
      senderUserId: auth.user.id,
      senderName: message.authorName,
      messageId: created.id,
      body,
      targetUserIds: resolvedMentions.map((mention) => mention.userId),
    })
  }
  if (!hasChimmy && hasAll) {
    await notifyWorldCupAllMention({
      challengeId: params.data.challengeId,
      senderUserId: auth.user.id,
      senderName: message.authorName,
      messageId: created.id,
      body,
    })
  }
  if (hasChimmy) {
    await notifyWorldCupChimmyReply({
      challengeId: params.data.challengeId,
      userId: auth.user.id,
      messageId: chimmyResponseMessage?.id ?? created.id,
    })
  }

  return NextResponse.json({
    ok: true,
    message,
    chimmyResponse: chimmyResponseMessage,
    messages: chimmyResponseMessage ? [message, chimmyResponseMessage] : [message],
  }, { status: 201 })
}
