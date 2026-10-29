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
  /**
   * The composer has collected a deadline on every poll it has ever posted and
   * stored it as `closeAt`. Nothing has ever read it back.
   */
  closesAt: string | null
  /** Closed explicitly by its author or a commissioner. */
  closedByHand: boolean
  /**
   * Also stored by the composer and also ignored until now: a multi-choice poll
   * behaved as single-choice, silently discarding the setting its author picked.
   */
  allowMultiple: boolean
  /** Voter identities are redacted server-side; only counts are knowable. */
  anonymous: boolean
  /** The author chose to show results only once the poll closes. */
  resultsAfterClose: boolean
  /**
   * The server withheld everyone else's votes because the poll is still open and its results are
   * shown only after close. Counts in `options` are then the viewer's own vote alone.
   */
  resultsHidden: boolean
  /** Set on a prediction poll (lib/league-chat/predictionPolls.ts) — tied to one matchup. */
  prediction: ViewerPrediction | null
}

export type ViewerPrediction = {
  week: number
  resolved: boolean
  /** null while unresolved, and on a tie. */
  winningOptionId: string | null
  tie: boolean
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

  const closesAtRaw = str(raw.closeAt)
  const closesAt = closesAtRaw && !Number.isNaN(new Date(closesAtRaw).getTime()) ? closesAtRaw : null

  return {
    question,
    options,
    totalVotes,
    closesAt,
    closedByHand: raw.closed === true,
    allowMultiple: raw.allowMultiple === true,
    anonymous: raw.anonymous === true,
    resultsAfterClose: raw.resultsVisibility === 'after_close',
    resultsHidden: raw.resultsHidden === true,
    prediction: readViewerPrediction(raw.prediction),
  }
}

function readViewerPrediction(raw: unknown): ViewerPrediction | null {
  if (!isRecord(raw) || raw.kind !== 'matchup') return null
  const week = Number(raw.week)
  const resolved = typeof raw.resolvedAt === 'string'
  return {
    week: Number.isFinite(week) ? week : 0,
    resolved,
    winningOptionId: resolved && typeof raw.winningOptionId === 'string' ? raw.winningOptionId : null,
    tie: resolved && raw.outcome === 'tie',
  }
}

/**
 * Is this poll finished?
 *
 * Two ways to be closed and both count: somebody closed it, or its deadline has
 * passed. `now` is injectable so the server can decide with its own clock — the
 * client's is not authoritative about whether voting is still open, and a device
 * with a slow clock must not be able to vote late.
 */
export function isPollClosed(poll: ViewerPoll, now: number = Date.now()): boolean {
  if (poll.closedByHand) return true
  if (!poll.closesAt) return false
  const deadline = new Date(poll.closesAt).getTime()
  return Number.isFinite(deadline) && deadline <= now
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
  if (isPollClosed(poll)) return poll
  const target = poll.options.find((o) => o.id === optionId)
  if (!target) return poll

  const withdrawing = target.mine

  const options = poll.options.map((o) => {
    /*
     * On a single-choice poll the vote MOVES; on a multi-choice one the other
     * options are none of this tap's business. `allowMultiple` has been stored
     * on every poll the composer has posted and ignored, so a poll whose author
     * chose multi-choice behaved as single-choice.
     */
    if (!poll.allowMultiple && o.mine && o.id !== optionId) {
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
 * Hide an open poll's results from a viewer when its author chose "results after close".
 *
 * ⚠ THE SAME RULE AS ANONYMITY: A REDACTION, NOT A RENDERING CHOICE. Every option's vote list
 * reaches the browser with the message, so a poll that merely did not DRAW its bars would still
 * ship the running tally to anyone who opens devtools. While the poll is open, every vote but the
 * viewer's own is removed and `resultsHidden` is set, so the UI can say why there are no numbers.
 * The viewer keeps their own vote — that is what lets them see and change their pick.
 *
 * `now` is the server's clock: the deadline is the server's to judge, as in the vote route.
 */
export function redactHiddenPollResults(
  metadata: unknown,
  viewerUserId: string | null | undefined,
  now: number = Date.now(),
): unknown {
  if (!isRecord(metadata) || !isRecord(metadata.poll)) return metadata
  const poll = metadata.poll
  if (poll.resultsVisibility !== 'after_close' || !Array.isArray(poll.options)) return metadata
  const closeAt = typeof poll.closeAt === 'string' ? Date.parse(poll.closeAt) : NaN
  const closed = poll.closed === true || (Number.isFinite(closeAt) && closeAt <= now)
  if (closed) return metadata

  const options = poll.options.map((entry) => {
    if (!isRecord(entry)) return entry
    const votes = Array.isArray(entry.votes) ? entry.votes : []
    return { ...entry, votes: viewerUserId && votes.includes(viewerUserId) ? [viewerUserId] : [] }
  })
  return { ...metadata, poll: { ...poll, options, resultsHidden: true } }
}

/**
 * Everything a viewer may not see on a poll, removed — hidden results first, then anonymity.
 * The one call read paths make, so a new rule lands everywhere at once.
 */
export function redactPollForViewer(
  metadata: unknown,
  viewerUserId: string | null | undefined,
  now: number = Date.now(),
): unknown {
  return redactAnonymousPollVotes(redactHiddenPollResults(metadata, viewerUserId, now), viewerUserId)
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

/**
 * Strip voter identities from an anonymous poll before it leaves the server.
 *
 * ⚠ ANONYMITY HAS TO BE A REDACTION, NOT A RENDERING CHOICE. A league poll
 * stores `options[].votes` as an array of user ids, and the whole metadata blob
 * is handed to the client. Marking a poll anonymous and simply not drawing the
 * names would ship every voter's id to every member's browser, where it is one
 * devtools tab away — which is not anonymity, it is the appearance of it.
 *
 * ⚠ THE VIEWER'S OWN ID SURVIVES, and that is not a leak: they already know how
 * they voted, and it is what lets the UI keep showing their choice and let them
 * change it. Everyone else becomes a distinct placeholder, so the COUNT is
 * preserved exactly while the identities are gone.
 *
 * The server keeps the real ids in the database, because preventing a second
 * vote requires knowing who has already voted. Anonymity here is about what
 * other members can see, not about the record.
 */
export function redactAnonymousPollVotes(
  metadata: unknown,
  viewerUserId: string | null | undefined,
): unknown {
  if (!isRecord(metadata) || !isRecord(metadata.poll)) return metadata
  const poll = metadata.poll
  if (poll.anonymous !== true || !Array.isArray(poll.options)) return metadata

  const options = poll.options.map((entry, optionIndex) => {
    if (!isRecord(entry)) return entry
    const votes = Array.isArray(entry.votes)
      ? entry.votes.filter((v): v is string => typeof v === 'string')
      : []

    return {
      ...entry,
      votes: votes.map((id, i) =>
        /*
         * Distinct per position so nothing downstream can collapse two voters
         * into one and undercount the result.
         */
        id === viewerUserId ? id : `anon:${optionIndex}:${i}`,
      ),
    }
  })

  return { ...metadata, poll: { ...poll, options } }
}
