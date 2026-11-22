/**
 * PollService — parse and vote for platform poll messages.
 */

export const POLL_MAX_OPTIONS = 6
const POLL_QUESTION_MAX_LENGTH = 200
const POLL_OPTION_MAX_LENGTH = 100

export type PollPayload = {
  question: string
  options: string[]
  votes?: Record<string, string[]>
  expiresAt?: string | null
  closed?: boolean
}

export function parsePollBody(body: string): PollPayload | null {
  try {
    const parsed = JSON.parse(body || "{}")
    if (parsed && typeof parsed.question === "string" && Array.isArray(parsed.options)) {
      const votesRaw =
        typeof parsed.votes === "object" && parsed.votes !== null
          ? (parsed.votes as Record<string, unknown>)
          : {}
      const votes: Record<string, string[]> = {}
      for (const [key, value] of Object.entries(votesRaw)) {
        votes[key] = Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : []
      }
      return {
        question: parsed.question,
        options: parsed.options.map(String),
        votes,
        expiresAt: parsed.expiresAt ?? null,
        closed: Boolean(parsed.closed),
      }
    }
  } catch {
    // ignore
  }
  return null
}

export function getVoteUrl(threadId: string, messageId: string): string {
  return `/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/vote`
}

export function getVotePayload(optionIndex: number): { optionIndex: number } {
  return { optionIndex }
}

export function getClosePollUrl(threadId: string, messageId: string): string {
  return `/api/shared/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/close-poll`
}

export function getCreatePollPayload(question: string, options: string[]): {
  question: string
  options: string[]
} {
  const q = question.trim().slice(0, POLL_QUESTION_MAX_LENGTH)
  const opts = options
    .slice(0, POLL_MAX_OPTIONS)
    .map((o) => String(o).trim().slice(0, POLL_OPTION_MAX_LENGTH))
    .filter(Boolean)
  return { question: q, options: opts }
}
