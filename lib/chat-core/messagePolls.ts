/**
 * READING AND VOTING ON THE POLLS LEAGUE CHAT ALREADY STORES.
 *
 * ⚠ THE VOTE ENDPOINT CANNOT SERVE A LEAGUE POLL, AND NEVER COULD. Unlike the
 * reactions route, `.../messages/[messageId]/vote` has no league branch at all:
 * it calls `votePollMessage`, which requires a `PlatformChatThreadMember` row
 * and a `PlatformChatMessage` of type 'poll'. League chat polls are
 * `LeagueChatMessage.metadata.poll`. Production holds 15 platform chat threads
 * and all 15 are 'ai', so that path could not have worked for any poll a person
 * has actually posted. Listing it as "a live endpoint that only needs a caller"
 * was wrong.
 *
 * ⚠ THERE ARE TWO POLL SHAPES IN THIS CODEBASE AND THEY ARE NOT INTERCHANGEABLE.
 * The platform one is `{ question, options: string[], votes: Record<idx, ids> }`;
 * the league one, which the composer writes and `RichMessage` renders, is
 * `{ question, options: [{ id, text, votes: string[] }] }`. This module speaks
 * the league shape only, and says so rather than pretending to handle both.
 */

export type ViewerPollOption = {
  id: string
  text: string
  count: number
  /** Whether this is the option the viewer chose. */
  mine: boolean
}

export type ViewerPoll = {
  question: string
  options: ViewerPollOption[]
  /** Total votes cast across all options — the honest denominator for a share. */
  totalVotes: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

/**
 * Pull a poll off message metadata from the viewer's point of view.
 *
 * Returns null rather than throwing on anything malformed: the source is
 * untrusted JSON in a message list, and one bad row must cost its own poll and
 * not the conversation around it.
 */
export function readViewerPoll(
  metadata: unknown,
  viewerUserId: string | null | undefined,
): ViewerPoll | null {
  if (!isRecord(metadata) || !isRecord(metadata.poll)) return null
  const raw = metadata.poll

  const question = str(raw.question)
  if (!question || !Array.isArray(raw.options)) return null

  const options: ViewerPollOption[] = []
  let totalVotes = 0

  raw.options.forEach((entry, i) => {
    if (!isRecord(entry)) return
    const text = str(entry.text)
    if (!text) return

    const votes = Array.isArray(entry.votes)
      ? entry.votes.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      : []

    totalVotes += votes.length
    options.push({
      id: str(entry.id) ?? `opt-${i}`,
      text,
      count: votes.length,
      mine: Boolean(viewerUserId) && votes.includes(viewerUserId as string),
    })
  })

  if (options.length === 0) return null
  return { question, options, totalVotes }
}

/**
 * The poll as it looks the instant the viewer taps, before the server answers.
 *
 * One vote per person: choosing a different option moves the vote rather than
 * adding one, and choosing the option you already hold withdraws it. The server
 * branch does exactly the same thing, so the optimistic state and the state that
 * comes back from a refetch agree.
 */
export function votePollLocally(poll: ViewerPoll, optionId: string): ViewerPoll {
  const target = poll.options.find((o) => o.id === optionId)
  if (!target) return poll

  const withdrawing = target.mine

  const options = poll.options.map((o) => {
    if (o.mine && o.id !== optionId) {
      /* The vote is moving away from this option. */
      return { ...o, count: Math.max(0, o.count - 1), mine: false }
    }
    if (o.id === optionId) {
      return withdrawing
        ? { ...o, count: Math.max(0, o.count - 1), mine: false }
        : { ...o, count: o.count + 1, mine: true }
    }
    return o
  })

  return { ...poll, options, totalVotes: options.reduce((n, o) => n + o.count, 0) }
}

/**
 * An option's share of the votes cast, 0-100.
 *
 * Zero when nothing has been cast — a poll with no votes has no proportions, and
 * drawing equal bars across the options would invent a tie nobody voted for.
 */
export function pollShare(option: ViewerPollOption, totalVotes: number): number {
  if (totalVotes <= 0) return 0
  return Math.round((option.count / totalVotes) * 100)
}
