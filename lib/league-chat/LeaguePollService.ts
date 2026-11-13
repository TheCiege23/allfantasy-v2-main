/**
 * LeaguePollService — payload and detection for league chat polls.
 * Bracket league API supports type "poll" with metadata.question and metadata.options.
 * Platform threads: poll can be a messageType with body/metadata; full UI is future.
 */

const LEAGUE_POLL_MAX_OPTIONS = 6
const LEAGUE_POLL_QUESTION_MAX_LENGTH = 200
const LEAGUE_POLL_OPTION_MAX_LENGTH = 100

export type LeaguePollPayload = {
  question: string
  options: string[]
  votes?: Record<string, string[]>
  closed?: boolean
}

export function createLeaguePollPayload(question: string, options: string[]): {
  question: string
  options: string[]
  votes?: Record<string, string[]>
} {
  const q = question.trim().slice(0, LEAGUE_POLL_QUESTION_MAX_LENGTH)
  const opts = options
    .slice(0, LEAGUE_POLL_MAX_OPTIONS)
    .map((o) => String(o).trim().slice(0, LEAGUE_POLL_OPTION_MAX_LENGTH))
    .filter(Boolean)
  return { question: q, options: opts, votes: {} }
}

export function isPollMessage(messageType: string, metadata?: { question?: string } | null): boolean {
  return messageType === "poll" || !!(metadata?.question)
}

export function parseLeaguePollPayload(input: {
  body?: string | null
  metadata?: Record<string, unknown> | null
}): LeaguePollPayload | null {
  const fromMetadata =
    input.metadata && typeof input.metadata.question === "string" && Array.isArray(input.metadata.options)
      ? {
          question: String(input.metadata.question),
          options: (input.metadata.options as unknown[]).map((o) => String(o)),
          votes:
            input.metadata.votes && typeof input.metadata.votes === "object"
              ? (input.metadata.votes as Record<string, string[]>)
              : {},
          closed: Boolean(input.metadata.closed),
        }
      : null
  if (fromMetadata) return fromMetadata

  try {
    const parsed = JSON.parse(input.body || "{}") as Record<string, unknown>
    if (typeof parsed.question !== "string" || !Array.isArray(parsed.options)) return null
    return {
      question: parsed.question,
      options: parsed.options.map((o) => String(o)),
      votes: parsed.votes && typeof parsed.votes === "object" ? (parsed.votes as Record<string, string[]>) : {},
      closed: Boolean(parsed.closed),
    }
  } catch {
    return null
  }
}

export function getLeaguePollVoteUrl(threadId: string, messageId: string): string {
  return `/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/vote`
}

export function getLeaguePollCloseUrl(threadId: string, messageId: string): string {
  return `/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/close-poll`
}
