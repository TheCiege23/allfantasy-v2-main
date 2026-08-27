import { NextRequest, NextResponse } from "next/server"
import { resolvePlatformUser } from "@/lib/platform/current-user"
import { votePollMessage } from "@/lib/platform/chat-service"
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from "@/lib/chat-core"
import { resolveLeagueAccess } from "@/lib/league-access"
import { prisma } from "@/lib/prisma"

/**
 * POST: record a poll vote for the given option.
 * Body: { optionIndex: number } — or { optionId: string } for a league poll.
 *
 * ⚠ THIS ROUTE HAD NO LEAGUE BRANCH, SO NO POLL A PERSON POSTED COULD BE VOTED
 * ON. Every other route beside it — reactions, pin, unpin — resolves a
 * `league:<id>` virtual room against `LeagueChatMessage`. This one went straight
 * to `votePollMessage`, which needs a `PlatformChatThreadMember` row and a
 * `PlatformChatMessage` of type 'poll'. Production holds 15 platform chat
 * threads and all 15 are 'ai', so this endpoint answered 400 for every real
 * poll and had no caller to notice.
 *
 * ⚠ THE TWO POLL SHAPES ARE NOT THE SAME. A platform poll is
 * `{ options: string[], votes: Record<index, ids> }` and is addressed by index.
 * A league poll is `{ options: [{ id, text, votes: string[] }] }` and is
 * addressed by option id, because its options carry their own ids and an index
 * into an array that another writer may reorder is not a stable handle on a
 * choice somebody made.
 */

type LeagueOption = { id?: unknown; text?: unknown; votes?: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { threadId: string; messageId: string } }
) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const messageId = decodeURIComponent(params.messageId)
  const body = await req.json().catch(() => ({}))

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: "Invalid league room" }, { status: 400 })

    /*
     * The same predicate that let this reader see the message. Voting in a poll
     * you can already read is not a wider permission than reading it.
     */
    const access = await resolveLeagueAccess(leagueId, user.appUserId)
    if (!access) return NextResponse.json({ error: "Not a member" }, { status: 403 })

    const optionId = typeof body?.optionId === "string" ? body.optionId.trim() : ""
    if (!optionId) {
      return NextResponse.json({ error: "optionId required for a league poll" }, { status: 400 })
    }

    const row = await (prisma as any).leagueChatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, leagueId: true, metadata: true },
    })
    if (!row || row.leagueId !== leagueId) {
      return NextResponse.json({ error: "Message not found in this league" }, { status: 404 })
    }

    const metadata = isRecord(row.metadata) ? row.metadata : {}
    const poll = isRecord(metadata.poll) ? metadata.poll : null
    if (!poll || !Array.isArray(poll.options)) {
      return NextResponse.json({ error: "That message is not a poll" }, { status: 400 })
    }

    /*
     * ⚠ THE DEADLINE IS ENFORCED HERE, NOT ONLY IN THE UI. The composer has
     * stored `closeAt` on every poll it has ever posted and nothing read it
     * back, so every poll ran forever. A device with a slow clock — or anything
     * that is not the drawer — must not be able to vote late, so the server
     * decides with its own clock and the UI's disabled state is a courtesy.
     */
    const closedByHand = poll.closed === true
    const closeAt = typeof poll.closeAt === "string" ? Date.parse(poll.closeAt) : NaN
    const pastDeadline = Number.isFinite(closeAt) && closeAt <= Date.now()
    if (closedByHand || pastDeadline) {
      return NextResponse.json({ error: "This poll is closed" }, { status: 409 })
    }

    const options = poll.options as LeagueOption[]
    const targetIndex = options.findIndex(
      (o, i) => (typeof o?.id === "string" && o.id ? o.id : `opt-${i}`) === optionId
    )
    if (targetIndex < 0) {
      return NextResponse.json({ error: "No such option" }, { status: 400 })
    }

    /*
     * One vote per person. Choosing a different option moves the vote rather
     * than adding a second one; choosing the option you already hold withdraws
     * it. The client's optimistic update does the same, so a refetch agrees.
     */
    const alreadyHere = Array.isArray(options[targetIndex]?.votes)
      ? (options[targetIndex].votes as unknown[]).includes(user.appUserId)
      : false

    /*
     * `allowMultiple` was stored by the composer and ignored too: a poll whose
     * author chose multi-choice behaved as single-choice, quietly discarding a
     * setting they had picked. On a multi-choice poll a tap only touches the
     * option tapped; on a single-choice one the vote moves.
     */
    const allowMultiple = poll.allowMultiple === true

    const nextOptions = options.map((o, i) => {
      const existing = Array.isArray(o?.votes)
        ? (o.votes as unknown[]).filter((v): v is string => typeof v === "string")
        : []

      if (allowMultiple && i !== targetIndex) return { ...o, votes: existing }

      const votes = existing.filter((v) => v !== user.appUserId)
      if (i === targetIndex && !alreadyHere) votes.push(user.appUserId as string)
      return { ...o, votes }
    })

    await (prisma as any).leagueChatMessage.update({
      where: { id: messageId },
      data: { metadata: { ...metadata, poll: { ...poll, options: nextOptions } } },
    })

    return NextResponse.json({ status: "ok" })
  }

  const optionIndex = Number(body?.optionIndex)
  if (!Number.isInteger(optionIndex) || optionIndex < 0) {
    return NextResponse.json({ error: "optionIndex required (non-negative integer)" }, { status: 400 })
  }

  const ok = await votePollMessage(user.appUserId, threadId, messageId, optionIndex)
  if (!ok) return NextResponse.json({ error: "Could not record vote" }, { status: 400 })

  return NextResponse.json({ status: "ok" })
}
