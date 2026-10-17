"use client"

import React from "react"
import Link from "next/link"
import type { PlatformChatMessage } from "@/types/platform-shared"
import {
  getReactionsFromMetadata,
  getAddReactionUrl,
  getRemoveReactionUrl,
  QUICK_REACTIONS,
  type ReactionEntry,
} from "./ReactionService"
import {
  getPinUrl,
  getUnpinUrl,
  getPinPayload,
  getUnpinPayload,
  getPinnedDisplayBody,
  getReferencedMessageIdFromPin,
} from "./PinnedMessageService"
import {
  isPollMessage,
  parsePollBody,
  getVoteUrl,
  getVotePayload,
  getClosePollUrl,
  type PollPayload,
} from "./PollService"
import { getMentionRanges } from "./MentionResolver"
import { RichMessageRenderer } from "@/lib/rich-message"

export type MessageInteractionRendererProps = {
  message: PlatformChatMessage
  threadId: string
  currentUserId: string | null
  /** Set of message IDs that are currently pinned (referenced by a pin message). */
  pinnedReferencedIds?: Set<string>
  onReactionUpdate?: () => void
  onPinUpdate?: () => void
  onVote?: () => void
  onPollClose?: () => void
  onImageClick?: (url: string) => void
  getMessageSnippet?: (messageId: string) => string
  className?: string
}

export function MessageInteractionRenderer({
  message,
  threadId,
  currentUserId,
  pinnedReferencedIds,
  onReactionUpdate,
  onPinUpdate,
  onVote,
  onPollClose,
  onImageClick,
  getMessageSnippet,
  className = "",
}: MessageInteractionRendererProps) {
  const meta = (message.metadata || {}) as Record<string, unknown>
  const reactions = getReactionsFromMetadata(meta)
  const isAlreadyPinned = pinnedReferencedIds?.has(message.id)
  const poll = message.messageType === "poll" ? parsePollBody(message.body || "") : null

  const handleAddReaction = async (emoji: string) => {
    try {
      await fetch(getAddReactionUrl(threadId, message.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      })
      onReactionUpdate?.()
    } catch {
      // ignore
    }
  }

  const handleRemoveReaction = async (emoji: string) => {
    try {
      await fetch(getRemoveReactionUrl(threadId, message.id), {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      })
      onReactionUpdate?.()
    } catch {
      // ignore
    }
  }

  const handlePin = async () => {
    try {
      const res = await fetch(getPinUrl(threadId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(getPinPayload(message.id)),
      })
      if (res.ok) onPinUpdate?.()
    } catch {
      // ignore
    }
  }

  const handleUnpin = async (pinMessageId: string) => {
    try {
      const res = await fetch(getUnpinUrl(threadId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(getUnpinPayload(pinMessageId)),
      })
      if (res.ok) onPinUpdate?.()
    } catch {
      // ignore
    }
  }

  const userHasReacted = (r: ReactionEntry) =>
    currentUserId && Array.isArray(r.userIds) && r.userIds.includes(currentUserId)

  const bodyWithMentionLinks = (body: string) => {
    const ranges = getMentionRanges(body)
    if (ranges.length === 0) return body
    const parts: React.ReactNode[] = []
    let last = 0
    ranges.forEach(({ start, end, username }) => {
      if (start > last) parts.push(body.slice(last, start))
      parts.push(
        <Link
          key={`${start}-${username}`}
          href={`/profile/${encodeURIComponent(username)}`}
          className="font-medium underline"
          style={{ color: "var(--accent-cyan-strong)" }}
        >
          @{username}
        </Link>
      )
      last = end
    })
    if (last < body.length) parts.push(body.slice(last))
    return parts
  }

  if (message.messageType === "pin") {
    const refId = getReferencedMessageIdFromPin(message)
    const snippet = refId && getMessageSnippet ? getMessageSnippet(refId) : undefined
    const display = snippet ?? getPinnedDisplayBody(message)
    return (
      <div className={className}>
        <div className="text-xs font-medium opacity-80 mb-0.5">📌 Pinned</div>
        <p className="text-sm">{display}</p>
        <button
          type="button"
          onClick={() => handleUnpin(message.id)}
          className="mt-1 text-xs"
          style={{ color: "var(--muted)" }}
        >
          Unpin
        </button>
      </div>
    )
  }

  if (poll) {
    return (
      <PollBlock
        message={message}
        poll={poll}
        threadId={threadId}
        currentUserId={currentUserId}
        onVote={onVote}
        onClose={onPollClose}
        className={className}
      />
    )
  }

  const isText = message.messageType === "text" || !message.messageType
  const hasMentions = isText && getMentionRanges(message.body || "").length > 0

  return (
    <div className={className}>
      {isText && hasMentions ? (
        <p className="mt-0.5 whitespace-pre-wrap break-words">
          {bodyWithMentionLinks(message.body || "")}
        </p>
      ) : (
        <RichMessageRenderer message={message} onImageClick={onImageClick} />
      )}
      <div className="flex flex-wrap items-center gap-1 mt-1">
        {reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            onClick={() => (userHasReacted(r) ? handleRemoveReaction(r.emoji) : handleAddReaction(r.emoji))}
            className="rounded-full px-1.5 py-0.5 text-xs border"
            style={{
              borderColor: "var(--border)",
              background: userHasReacted(r) ? "color-mix(in srgb, var(--accent-cyan-strong) 15%, transparent)" : "var(--panel2)",
            }}
          >
            {r.emoji} {r.count}
          </button>
        ))}
        <div className="flex gap-0.5">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleAddReaction(emoji)}
              className="opacity-70 hover:opacity-100 text-sm leading-none"
              aria-label={`React ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        {message.messageType !== "pin" && message.messageType !== "poll" && !isAlreadyPinned && (
          <button
            type="button"
            onClick={handlePin}
            className="text-xs"
            style={{ color: "var(--muted)" }}
            title="Pin message"
          >
            Pin
          </button>
        )}
        {isAlreadyPinned && (
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>Pinned</span>
        )}
      </div>
    </div>
  )
}

function PollBlock({
  message,
  poll,
  threadId,
  currentUserId,
  onVote,
  onClose,
  className,
}: {
  message: PlatformChatMessage
  poll: PollPayload
  threadId: string
  currentUserId: string | null
  onVote?: () => void
  onClose?: () => void
  className: string
}) {
  const votes = poll.votes || {}
  const totalVotes = Object.values(votes).reduce((sum, arr) => sum + (arr?.length ?? 0), 0)
  const userVotedIndex = currentUserId
    ? Object.entries(votes).find(([, ids]) => Array.isArray(ids) && ids.includes(currentUserId))?.[0]
    : null
  const isClosed = Boolean(poll.closed)

  const handleVote = async (optionIndex: number) => {
    if (isClosed) return
    try {
      const res = await fetch(getVoteUrl(threadId, message.id), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(getVotePayload(optionIndex)),
      })
      if (res.ok) onVote?.()
    } catch {
      // ignore
    }
  }

  const handleClosePoll = async () => {
    try {
      const res = await fetch(getClosePollUrl(threadId, message.id), { method: "POST" })
      if (res.ok) onClose?.()
    } catch {
      // ignore
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-sm font-medium flex-1">{poll.question}</p>
        {isClosed && (
          <span className="text-[11px] shrink-0 rounded px-1.5 py-0.5" style={{ background: "var(--panel2)", color: "var(--muted)" }}>
            Closed
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {poll.options.map((label, i) => {
          const count = (votes[String(i)]?.length ?? 0)
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
          const isSelected = userVotedIndex === String(i)
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => handleVote(i)}
                disabled={isClosed}
                className="w-full text-left rounded-lg border px-2 py-1.5 text-sm flex items-center justify-between gap-2 disabled:opacity-80"
                style={{
                  borderColor: isSelected ? "var(--accent-cyan-strong)" : "var(--border)",
                  background: isSelected ? "color-mix(in srgb, var(--accent-cyan-strong) 10%, transparent)" : "var(--panel2)",
                }}
              >
                <span>{label}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {pct}% ({count})
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {totalVotes > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
          {totalVotes} vote{totalVotes !== 1 ? "s" : ""}
        </p>
      )}
      {!isClosed && userVotedIndex !== null && userVotedIndex !== undefined && (
        <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
          You can change your vote.
        </p>
      )}
      {!isClosed && onClose && (
        <button
          type="button"
          onClick={handleClosePoll}
          className="mt-2 text-xs"
          style={{ color: "var(--muted)" }}
        >
          Close poll
        </button>
      )}
    </div>
  )
}
