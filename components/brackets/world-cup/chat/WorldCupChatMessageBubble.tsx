"use client"

/**
 * WorldCupChatMessageBubble
 *
 * Renders a single chat message with visually distinct variants:
 *
 *   chimmy        — AI response: glowing cyan card, Bot avatar, AI/freshness chips,
 *                   private badge, copy button, "Post to pool" hook
 *   pool-self     — User's own message: right-aligned, tinted
 *   pool-other    — Other user's message: standard card
 *   commissioner  — Commissioner announcement: gold tinted
 *   system        — System event: centered, muted
 *   poll          — Inline poll card (handled separately, embedded in other variants)
 *
 * Rendering is purely presentational — no fetch/mutation logic.
 */

import { Bot, Check, Copy, Share2 } from "lucide-react"
import { useState } from "react"
import { ChimmyFreshnessChip } from "../ChimmyFreshnessChip"
import type {
  WorldCupChatGifAttachment,
  WorldCupChatImageAttachment,
  WorldCupChatPollAttachment,
  WorldCupPoolChatMessage,
} from "./worldCupChatTypes"

// ─── Sub-components used inside the bubble ───────────────────────────────────

function PollMessageInline({
  poll,
  messageId,
  isVoting,
  onVote,
}: {
  poll: WorldCupChatPollAttachment
  messageId: string
  isVoting: boolean
  onVote: (optionId: string) => void
}) {
  return (
    <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
      <p className="text-xs font-black text-white">{poll.question}</p>
      <div className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const selected = poll.currentUserVote === option.id
          return (
            <button
              key={`${messageId}-${option.id}`}
              type="button"
              onClick={() => onVote(option.id)}
              disabled={isVoting || poll.closed}
              className={[
                "w-full overflow-hidden rounded-lg border bg-black/25 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-65",
                selected ? "border-cyan-300/70" : "border-white/10 hover:border-cyan-300/35",
              ].join(" ")}
            >
              <span className="relative block">
                <span
                  className="absolute inset-y-0 left-0 bg-cyan-300/15"
                  style={{ width: `${option.percentage}%` }}
                  aria-hidden
                />
                <span className="relative flex items-center justify-between gap-2 px-3 py-2">
                  <span className="font-bold text-white/75">{option.label}</span>
                  <span className="text-[11px] font-black text-white/65">
                    {option.votes} vote{option.votes === 1 ? "" : "s"} · {option.percentage}%
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-white/35">
        {poll.totalVotes} total vote{poll.totalVotes === 1 ? "" : "s"}
        {poll.currentUserVote ? " · Your vote is counted" : ""}
        {poll.closed ? " · Closed" : ""}
      </p>
    </div>
  )
}

function GifPreviewInline({ gif }: { gif: WorldCupChatGifAttachment }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-white/12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={gif.previewUrl}
        alt={gif.title || "GIF"}
        className="max-h-40 w-full object-cover"
        loading="lazy"
      />
    </div>
  )
}

function ImagePreviewInline({ image }: { image: WorldCupChatImageAttachment }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-white/12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.secureUrl}
        alt="Shared image"
        className="max-h-56 w-full object-cover"
        loading="lazy"
      />
    </div>
  )
}

// ─── Copy button — client-side only ──────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {/* ignore */})
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy message"}
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] font-bold text-white/50 transition hover:border-cyan-300/25 hover:text-white/75 touch-manipulation"
    >
      {copied
        ? <Check className="h-2.5 w-2.5" aria-hidden />
        : <Copy className="h-2.5 w-2.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export type WorldCupChatMessageBubbleProps = {
  message: WorldCupPoolChatMessage
  /** Whether the current user is voting on this message's poll */
  isVoting?: boolean
  /** Called when user votes on an inline poll */
  onVote?: (optionId: string) => void
  /**
   * Called when user clicks "Post to pool" on a private Chimmy answer.
   * Parent shows a preview/confirm flow. If undefined, button is hidden.
   */
  onPostToPool?: (message: WorldCupPoolChatMessage) => void
  /** i18n label overrides — defaults to English */
  labels?: {
    aiLabel?: string
    privateLabel?: string
    postToPool?: string
  }
}

export function WorldCupChatMessageBubble({
  message,
  isVoting = false,
  onVote,
  onPostToPool,
  labels = {},
}: WorldCupChatMessageBubbleProps) {
  const isChimmy = message.messageType === "chimmy_private_response"
  const isCommissioner = message.messageType === "commissioner_announcement"
  const isSystem = message.messageType === "system" || message.messageType === "event"

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })

  // ── System / event messages ─────────────────────────────────────────────

  if (isSystem) {
    return (
      <div
        data-testid={`wc-msg-${message.id}`}
        data-msg-type="system"
        className="flex justify-center py-1"
      >
        <span className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-0.5 text-[11px] text-white/38">
          {message.body}
        </span>
      </div>
    )
  }

  // ── Chimmy AI messages ───────────────────────────────────────────────────

  if (isChimmy) {
    return (
      <div
        data-testid={`wc-msg-${message.id}`}
        data-msg-type="chimmy"
        className="rounded-[1.15rem] border border-cyan-400/45 bg-gradient-to-br from-cyan-500/[0.18] to-violet-500/[0.10] shadow-[0_0_0_1px_rgba(34,211,238,0.10),0_12px_32px_-20px_rgba(34,211,238,0.45)] p-3.5"
      >
        {/* Header row: Chimmy identity + freshness chips + time */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0">
            {/* Bot avatar */}
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/35 bg-cyan-500/20 text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.25)]">
              <Bot className="h-3.5 w-3.5" aria-hidden />
            </span>
            {/* Chimmy name */}
            <span className="text-sm font-black text-cyan-100">
              {labels.aiLabel ?? "Chimmy"}
            </span>
            {/* AI pill */}
            <span
              className="rounded-full border border-cyan-400/35 bg-cyan-400/[0.12] px-1.5 py-px text-[11px] font-black uppercase tracking-wide text-cyan-300/90"
              aria-label="AI-generated response"
            >
              AI
            </span>
            {/* Freshness chip — data source label */}
            {message.dataSourceDisplay ? (
              <ChimmyFreshnessChip
                tier={message.dataSourceTier ?? "pool_only"}
                label={message.dataSourceDisplay}
              />
            ) : null}
            {/* Private badge */}
            {message.isPrivate ? (
              <span className="rounded-full border border-purple-400/30 bg-purple-400/[0.08] px-1.5 py-px text-[11px] font-bold uppercase tracking-wide text-purple-300/75">
                {labels.privateLabel ?? "Private"}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-[11px] text-cyan-300/45">{time}</span>
        </div>

        {/* Message body */}
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-cyan-50/92">
          {message.body}
        </p>

        {/* Media */}
        {message.gif ? <GifPreviewInline gif={message.gif} /> : null}
        {message.image ? <ImagePreviewInline image={message.image} /> : null}

        {/* Poll (Chimmy can post polls too) */}
        {message.poll && onVote ? (
          <PollMessageInline
            poll={message.poll}
            messageId={message.id}
            isVoting={isVoting}
            onVote={onVote}
          />
        ) : null}

        {/* Action row: Copy + Post to pool */}
        <div className="mt-2.5 flex items-center gap-1.5">
          <CopyButton text={message.body} />
          {onPostToPool && message.isPrivate ? (
            <button
              type="button"
              onClick={() => onPostToPool(message)}
              className="inline-flex items-center gap-1 rounded-full border border-cyan-300/18 bg-cyan-300/[0.06] px-2 py-0.5 text-[11px] font-bold text-cyan-300/65 transition hover:border-cyan-300/40 hover:text-cyan-200 touch-manipulation"
            >
              <Share2 className="h-2.5 w-2.5" aria-hidden />
              {labels.postToPool ?? "Post to pool"}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  // ── Commissioner announcement ────────────────────────────────────────────

  if (isCommissioner) {
    return (
      <div
        data-testid={`wc-msg-${message.id}`}
        data-msg-type="commissioner"
        className="rounded-xl border border-amber-400/35 bg-gradient-to-br from-amber-400/[0.12] to-amber-500/[0.05] px-3.5 py-2.5 shadow-[0_8px_24px_-18px_rgba(251,191,36,0.4)]"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-black">
            <span className="rounded-full border border-amber-400/35 bg-amber-400/[0.12] px-1.5 py-px text-[11px] font-black uppercase tracking-wide text-amber-300/80">
              Commissioner
            </span>
            <span className="text-sm text-amber-100">{message.authorName}</span>
          </span>
          <span className="text-[11px] text-amber-300/40">{time}</span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-amber-50/88">
          {message.body}
        </p>
        {message.gif ? <GifPreviewInline gif={message.gif} /> : null}
        {message.image ? <ImagePreviewInline image={message.image} /> : null}
      </div>
    )
  }

  // ── Pool messages (own vs other) ─────────────────────────────────────────

  if (message.isOwnMessage) {
    return (
      <div
        data-testid={`wc-msg-${message.id}`}
        data-msg-type="pool-self"
        className="ml-auto max-w-[85%] rounded-xl border border-cyan-300/20 bg-cyan-500/[0.10] px-3.5 py-2.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-black text-cyan-100/80">You</span>
          <span className="text-[11px] text-cyan-300/40">{time}</span>
        </div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-100/90">
          {message.body}
        </p>
        {message.gif ? <GifPreviewInline gif={message.gif} /> : null}
        {message.image ? <ImagePreviewInline image={message.image} /> : null}
        {message.poll && onVote ? (
          <PollMessageInline
            poll={message.poll}
            messageId={message.id}
            isVoting={isVoting}
            onVote={onVote}
          />
        ) : null}
      </div>
    )
  }

  // Default: another user's pool message
  return (
    <div
      data-testid={`wc-msg-${message.id}`}
      data-msg-type="pool-other"
      className="rounded-xl border border-white/12 bg-white/[0.055] px-3.5 py-2.5 shadow-[0_4px_16px_-12px_rgba(0,0,0,0.6)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-black text-slate-50">{message.authorName}</span>
        <span className="text-[11px] text-slate-300/55">{time}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-100/86">
        {message.body}
      </p>
      {message.gif ? <GifPreviewInline gif={message.gif} /> : null}
      {message.image ? <ImagePreviewInline image={message.image} /> : null}
      {message.poll && onVote ? (
        <PollMessageInline
          poll={message.poll}
          messageId={message.id}
          isVoting={isVoting}
          onVote={onVote}
        />
      ) : null}
      {message.isPrivate ? (
        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-white/50">
          {labels.privateLabel ?? "Private"}
        </p>
      ) : null}
    </div>
  )
}
