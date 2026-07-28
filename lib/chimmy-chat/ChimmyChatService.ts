import type {
  AIChatContext,
  ChimmyAnswerContract,
  ChimmyMessageMeta,
  ChimmyResponseSectionTitles,
  ChimmyThreadMessage,
} from "./types"
import {
  CHIMMY_DEFAULT_UPGRADE_PATH,
  CHIMMY_GENERIC_ERROR_MESSAGE,
  CHIMMY_PREMIUM_CTA_LABEL,
  CHIMMY_PREMIUM_FEATURE_MESSAGE,
  isChimmyPremiumGateResponse,
  resolveChimmyUpgradePath,
} from "@/lib/chimmy-chat/response-copy"
import {
  DEFAULT_CHIMMY_ASSISTANT_MODE,
  normalizeChimmyAssistantMode,
} from "@/lib/chimmy-chat/assistant-mode"
import { confirmTokenSpend } from "@/lib/tokens/client-confirm"
import { isSupportedChimmySchemaVersion, normalizeMissingInformation } from "@/lib/chimmy-chat/responseEnvelope"
import { prepareImageForChimmyUpload } from "@/lib/chimmy-chat/prepareImageForChimmyUpload"

type SendChimmyMessageInput = {
  message: string
  imageFile?: File | null
  conversation?: ChimmyThreadMessage[]
  context?: AIChatContext
  confirmTokenSpend?: boolean
  onChunk?: (text: string) => void
}

type SendChimmyMessageResult = {
  ok: boolean
  response: string
  meta?: ChimmyMessageMeta
  error?: string
  upgradeRequired?: boolean
  upgradePath?: string
  sessionId?: string
}

function toConversationPayload(conversation: ChimmyThreadMessage[] = []) {
  return conversation.slice(-10).map((m) => ({
    role: m.role,
    content: m.content,
  }))
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.length > 0) {
        resolve(reader.result)
        return
      }
      reject(new Error("Failed to encode image upload."))
    }
    reader.onerror = () => reject(new Error("Failed to read image upload."))
    reader.readAsDataURL(file)
  })
}

function toMeta(rawMeta: unknown): ChimmyMessageMeta | undefined {
  if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) return undefined
  const meta = rawMeta as Record<string, unknown>
  // Envelope version gate: a meta that declares an UNSUPPORTED schemaVersion is not renderable here — drop
  // it so the caller falls back to text-only. Absent version = legacy meta (render best-effort). The
  // version (like every meta field) is server-authored; the client only uses it to decide renderability.
  if (meta.schemaVersion !== undefined && !isSupportedChimmySchemaVersion(meta.schemaVersion)) {
    return undefined
  }
  const responseStructureRaw =
    meta.responseStructure && typeof meta.responseStructure === "object" && !Array.isArray(meta.responseStructure)
      ? (meta.responseStructure as Record<string, unknown>)
      : null
  const syncFreshnessRaw =
    meta.syncFreshness && typeof meta.syncFreshness === "object" && !Array.isArray(meta.syncFreshness)
      ? (meta.syncFreshness as Record<string, unknown>)
      : null
  const sportsDigestRaw =
    syncFreshnessRaw?.sportsDigest &&
    typeof syncFreshnessRaw.sportsDigest === "object" &&
    !Array.isArray(syncFreshnessRaw.sportsDigest)
      ? (syncFreshnessRaw.sportsDigest as Record<string, unknown>)
      : null
  const perSourceRaw =
    sportsDigestRaw?.perSource &&
    typeof sportsDigestRaw.perSource === "object" &&
    !Array.isArray(sportsDigestRaw.perSource)
      ? (sportsDigestRaw.perSource as Record<string, unknown>)
      : null
  const normalizedPerSource = perSourceRaw
    ? Object.fromEntries(
        Object.entries(perSourceRaw)
          .filter(([key, value]) => key.trim().length > 0 && (typeof value === "string" || value === null))
          .map(([key, value]) => [key, value as string | null])
      )
    : undefined
  const shortAnswer =
    typeof responseStructureRaw?.shortAnswer === "string" ? responseStructureRaw.shortAnswer.trim() : ""
  const caveats = Array.isArray(responseStructureRaw?.caveats)
    ? responseStructureRaw.caveats.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []

  const titlesRaw =
    responseStructureRaw?.sectionTitles && typeof responseStructureRaw.sectionTitles === "object" && !Array.isArray(responseStructureRaw.sectionTitles)
      ? (responseStructureRaw.sectionTitles as Record<string, unknown>)
      : null
  const pickTitle = (key: string): string | undefined => {
    const v = titlesRaw?.[key]
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined
  }
  const sectionTitlesCandidate: ChimmyResponseSectionTitles | undefined = titlesRaw
    ? {
        shortAnswer: pickTitle("shortAnswer"),
        whatDataSays: pickTitle("whatDataSays"),
        whatItMeans: pickTitle("whatItMeans"),
        recommendedAction: pickTitle("recommendedAction"),
        caveats: pickTitle("caveats"),
      }
    : undefined
  const sectionTitles =
    sectionTitlesCandidate &&
    Object.values(sectionTitlesCandidate).some((v) => typeof v === "string" && v.length > 0)
      ? sectionTitlesCandidate
      : undefined
  const answerContractRaw =
    meta.answerContract && typeof meta.answerContract === "object" && !Array.isArray(meta.answerContract)
      ? (meta.answerContract as Record<string, unknown>)
      : null
  const sourceLinksRaw = Array.isArray(meta.sourceLinks)
    ? meta.sourceLinks
    : []
  const sourceLinks = sourceLinksRaw
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null
      const entry = item as Record<string, unknown>
      const label = typeof entry.label === "string" ? entry.label.trim() : ""
      const href = typeof entry.href === "string" ? entry.href.trim() : ""
      if (!label || !href) return null
      return { label, href }
    })
    .filter((item): item is { label: string; href: string } => item != null)
  const modeRaw =
    typeof meta.mode === "string"
      ? meta.mode
      : typeof meta.assistantMode === "string"
        ? meta.assistantMode
        : undefined
  const answerContract =
    answerContractRaw && typeof answerContractRaw.answerType === "string"
      ? (answerContractRaw as ChimmyAnswerContract)
      : undefined

  return {
    schemaVersion: typeof meta.schemaVersion === "string" ? meta.schemaVersion : undefined,
    intent: typeof meta.intent === "string" ? meta.intent : undefined,
    missingInformation: normalizeMissingInformation(meta.missingInformation),
    fallbackState: typeof meta.fallbackState === "string" ? meta.fallbackState : undefined,
    mode: modeRaw ? normalizeChimmyAssistantMode(modeRaw) : undefined,
    answerContract,
    confidencePct: typeof meta.confidencePct === "number" ? meta.confidencePct : undefined,
    providerStatus:
      meta.providerStatus && typeof meta.providerStatus === "object" && !Array.isArray(meta.providerStatus)
        ? (meta.providerStatus as Record<string, string>)
        : undefined,
    recommendedTool: typeof meta.recommendedTool === "string" ? meta.recommendedTool : undefined,
    orchestration:
      meta.orchestration && typeof meta.orchestration === "object" && !Array.isArray(meta.orchestration)
        ? (meta.orchestration as ChimmyMessageMeta["orchestration"])
        : undefined,
    dataSources: Array.isArray(meta.dataSources) ? meta.dataSources.filter((x): x is string => typeof x === "string") : undefined,
    sourceLinks: sourceLinks.length > 0 ? sourceLinks : undefined,
    syncFreshness:
      syncFreshnessRaw
        ? {
            referenceTimezone:
              typeof syncFreshnessRaw.referenceTimezone === "string"
                ? syncFreshnessRaw.referenceTimezone
                : undefined,
            sportsDigest:
              sportsDigestRaw
                ? {
                    overallLastSyncedAt:
                      typeof sportsDigestRaw.overallLastSyncedAt === "string" ||
                      sportsDigestRaw.overallLastSyncedAt === null
                        ? (sportsDigestRaw.overallLastSyncedAt as string | null)
                        : undefined,
                    perSource: normalizedPerSource,
                  }
                : undefined,
          }
        : undefined,
    quantData: meta.quantData && typeof meta.quantData === "object" ? (meta.quantData as Record<string, unknown>) : undefined,
    trendData: meta.trendData && typeof meta.trendData === "object" ? (meta.trendData as Record<string, unknown>) : undefined,
    responseStructure:
      shortAnswer.length > 0
        ? {
            shortAnswer,
            whatDataSays:
              typeof responseStructureRaw?.whatDataSays === "string" ? responseStructureRaw.whatDataSays : undefined,
            whatItMeans:
              typeof responseStructureRaw?.whatItMeans === "string" ? responseStructureRaw.whatItMeans : undefined,
            recommendedAction:
              typeof responseStructureRaw?.recommendedAction === "string"
                ? responseStructureRaw.recommendedAction
                : undefined,
            caveats,
            ...(sectionTitles ? { sectionTitles } : {}),
          }
        : undefined,
    variant:
      meta.variant === "premium_gate" || meta.variant === "error"
        ? meta.variant
        : undefined,
    ctaLabel: typeof meta.ctaLabel === "string" ? meta.ctaLabel : undefined,
    ctaHref: typeof meta.ctaHref === "string" ? meta.ctaHref : undefined,
  }
}

export async function sendChimmyMessage(input: SendChimmyMessageInput): Promise<SendChimmyMessageResult> {
  let shouldConfirmTokenSpend = input.confirmTokenSpend ?? true
  if (shouldConfirmTokenSpend) {
    try {
      const { confirmed, preview } = await confirmTokenSpend("ai_chimmy_chat_message")
      if (!preview.canSpend) {
        return {
          ok: true,
          response: CHIMMY_PREMIUM_FEATURE_MESSAGE,
          meta: {
            variant: "premium_gate",
            ctaLabel: CHIMMY_PREMIUM_CTA_LABEL,
            ctaHref: CHIMMY_DEFAULT_UPGRADE_PATH,
          },
          upgradeRequired: true,
          upgradePath: CHIMMY_DEFAULT_UPGRADE_PATH,
        }
      }
      if (!confirmed) {
        return {
          ok: false,
          response: "Token spend cancelled.",
          error: "Token spend cancelled by user.",
        }
      }
    } catch (error) {
      console.error(
        "[sendChimmyMessage] Token preview failed, continuing without preflight:",
        error instanceof Error ? error.message : error
      )
      shouldConfirmTokenSpend = false
    }
  }

  const conversation = toConversationPayload(input.conversation)
  const selectedMode = normalizeChimmyAssistantMode(
    input.context?.assistantMode ?? input.context?.strategyMode ?? DEFAULT_CHIMMY_ASSISTANT_MODE,
  )
  let fileForUpload = input.imageFile
  if (fileForUpload && fileForUpload.size > 0 && typeof window !== "undefined") {
    try {
      fileForUpload = await prepareImageForChimmyUpload(fileForUpload)
    } catch {
      /* use original */
    }
  }
  const imageDataUrl =
    fileForUpload && fileForUpload.size > 0 ? await fileToDataUrl(fileForUpload) : undefined
  const payload = {
    message: input.message,
    stream: typeof input.onChunk === "function",
    confirmTokenSpend: shouldConfirmTokenSpend,
    conversation: conversation.length > 0 ? conversation : undefined,
    image: imageDataUrl
      ? {
          dataUrl: imageDataUrl,
          name: fileForUpload?.name || input.imageFile?.name || undefined,
          type: fileForUpload?.type || input.imageFile?.type || undefined,
        }
      : undefined,
    userContext: {
      leagueId: input.context?.leagueId,
      leagueName: input.context?.leagueName,
      sportScope: input.context?.sportScope,
      sleeperUsername: input.context?.sleeperUsername,
      insightType: input.context?.insightType,
      teamId: input.context?.teamId,
      sport: input.context?.sport,
      leagueFormat: input.context?.leagueFormat,
      scoring: input.context?.scoring,
      season: input.context?.season,
      week: input.context?.week,
      conversationId: input.context?.conversationId,
      sessionId: input.context?.sessionId,
      privateMode: input.context?.privateMode,
      targetUsername: input.context?.targetUsername,
      assistantMode: selectedMode,
      strategyMode: selectedMode,
      source: input.context?.source,
      memory: input.context?.memory,
    },
  }

  const res = await fetch("/api/chimmy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  })
  const contentType = res.headers.get("content-type") || ""
  let data: any = {}

  if (contentType.includes("text/event-stream") && res.body) {
    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    let buffer = ""
    let responseText = ""

    const processEvent = (rawBlock: string) => {
      const lines = rawBlock
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      let event = "message"
      const dataLines: string[] = []

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim()
          continue
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim())
        }
      }

      const payloadRaw = dataLines.join("\n")
      const eventPayload = payloadRaw ? JSON.parse(payloadRaw) : {}

      if (event === "chunk") {
        const nextText =
          typeof eventPayload?.response === "string"
            ? eventPayload.response
            : typeof eventPayload?.delta === "string"
              ? responseText + eventPayload.delta
              : responseText
        responseText = nextText
        input.onChunk?.(responseText)
        return
      }

      if (event === "done") {
        data = eventPayload
        if (!responseText && typeof eventPayload?.response === "string") {
          responseText = eventPayload.response
          input.onChunk?.(responseText)
        }
        return
      }

      if (event === "error") {
        throw new Error(
          typeof eventPayload?.error === "string" ? eventPayload.error : "Chimmy stream failed"
        )
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const normalized = buffer.replace(/\r\n/g, "\n")
      let boundary = normalized.indexOf("\n\n")
      if (boundary === -1) {
        buffer = normalized
        continue
      }
      let working = normalized
      while (boundary !== -1) {
        const block = working.slice(0, boundary)
        working = working.slice(boundary + 2)
        if (block.trim().length > 0) {
          processEvent(block)
        }
        boundary = working.indexOf("\n\n")
      }
      buffer = working
    }

    if (!data.response && responseText) {
      data = { response: responseText, result: responseText }
    }
  } else {
    data = await res.json().catch(() => ({}))
  }

  const response =
    typeof data?.result === "string"
      ? data.result
      : typeof data?.response === "string"
        ? data.response
        : ""
  const upgradeRequired = isChimmyPremiumGateResponse({
    status: res.status,
    code: data?.code,
    upgradeRequired: data?.upgradeRequired,
  })
  const upgradePath = upgradeRequired
    ? resolveChimmyUpgradePath(data?.upgradePath)
    : undefined
  const metaCandidate = {
    ...(toMeta(data?.meta) ?? {}),
    ...(upgradeRequired
      ? {
          variant: "premium_gate" as const,
          ctaLabel: CHIMMY_PREMIUM_CTA_LABEL,
          ctaHref: upgradePath ?? CHIMMY_DEFAULT_UPGRADE_PATH,
        }
      : !res.ok
        ? {
            variant: "error" as const,
          }
        : {}),
  }
  const meta = Object.keys(metaCandidate).length > 0 ? metaCandidate : undefined
  const error =
    upgradeRequired
      ? undefined
      : typeof data?.error === "string"
      ? data.error
      : typeof data?.message === "string"
        ? data.message
        : res.status >= 500
          ? CHIMMY_GENERIC_ERROR_MESSAGE
          : `Request failed (${res.status})`
  const fallbackResponse = upgradeRequired
    ? CHIMMY_PREMIUM_FEATURE_MESSAGE
    : CHIMMY_GENERIC_ERROR_MESSAGE

  if (!res.ok && !upgradeRequired) {
    return {
      ok: false,
      response: response || fallbackResponse,
      error: error || CHIMMY_GENERIC_ERROR_MESSAGE,
      meta,
    }
  }

  return {
    ok: true,
    response: response || fallbackResponse,
    meta,
    sessionId: typeof data?.sessionId === "string" ? data.sessionId : undefined,
    ...(upgradeRequired
      ? {
          upgradeRequired: true,
          upgradePath,
        }
      : {}),
  }
}
