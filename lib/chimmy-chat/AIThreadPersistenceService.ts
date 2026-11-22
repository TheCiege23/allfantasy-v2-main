import type { AIChatContext, ChimmyThreadMessage } from "./types"

const STORAGE_PREFIX = "allfantasy:chimmy-thread:v1"
const MAX_STORED_MESSAGES = 80

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function cleanKeyPart(value: string | undefined): string {
  if (!value) return "none"
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 80) || "none"
}

export function getAIThreadStorageKey(
  context?: Pick<AIChatContext, "leagueId" | "sport" | "sportScope" | "insightType" | "teamId" | "conversationId">
): string {
  const league = cleanKeyPart(context?.leagueId)
  const sport = cleanKeyPart(context?.sport)
  const sportScope = cleanKeyPart(context?.sportScope)
  const insight = cleanKeyPart(context?.insightType)
  const team = cleanKeyPart(context?.teamId)
  const conversation = cleanKeyPart(context?.conversationId)
  return `${STORAGE_PREFIX}:${league}:${sport}:${sportScope}:${insight}:${team}:${conversation}`
}

function sanitizeMessages(messages: ChimmyThreadMessage[]): ChimmyThreadMessage[] {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .filter((m) => m.meta?.variant !== "error")
    .slice(-MAX_STORED_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 4000),
      imageUrl: m.imageUrl ?? null,
      meta: m.meta ?? null,
    }))
}

export function loadAIThreadMessages(storageKey: string): ChimmyThreadMessage[] {
  if (!canUseStorage()) return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? sanitizeMessages(parsed as ChimmyThreadMessage[]) : []
  } catch {
    return []
  }
}

export function saveAIThreadMessages(storageKey: string, messages: ChimmyThreadMessage[]): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(sanitizeMessages(messages)))
  } catch {
    // Ignore quota/storage errors.
  }
}

