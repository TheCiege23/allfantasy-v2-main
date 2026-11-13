"use client"

/**
 * WorldCupChatEmptyState
 *
 * Mode-aware empty / loading / error states for the chat panel.
 * Pool, AI, and DM modes each have distinct copy.
 *
 * Loading state: "Chimmy is thinking…" (AI mode) or a plain spinner (pool/DM).
 * Error state: actionable message telling the user what went wrong.
 */

import { Bot, Loader2, MessageSquare } from "lucide-react"
import type { WorldCupChatMode } from "./worldCupChatTypes"

type WorldCupChatEmptyStateProps = {
  mode: WorldCupChatMode
  isLoading: boolean
  error?: string | null
  /** Called when user clicks a suggested prompt chip in AI empty state */
  onSuggestPrompt?: (prompt: string) => void
  /** Suggested prompts shown in AI empty state — max 3 */
  suggestedPrompts?: Array<{ key: string; label: string; prompt: string }>
}

const AI_DEFAULT_PROMPTS = [
  { key: "path", label: "My path to first", prompt: "Explain my path to first place" },
  { key: "swing", label: "Biggest swing match", prompt: "What match could change my rank the most?" },
  { key: "rooting", label: "Who am I rooting for?", prompt: "Who should I be rooting for right now?" },
]

export function WorldCupChatEmptyState({
  mode,
  isLoading,
  error,
  onSuggestPrompt,
  suggestedPrompts,
}: WorldCupChatEmptyStateProps) {
  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    if (mode === "ai") {
      return (
        <div
          data-testid="wc-chat-loading-ai"
          className="flex min-h-[14rem] flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center"
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/35 bg-cyan-400/[0.08] text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.2)]">
            <Bot className="h-6 w-6 animate-pulse" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-black text-cyan-100/80">Chimmy is thinking…</p>
            <p className="mt-0.5 text-xs text-cyan-300/45">Checking pool standings and live data</p>
          </div>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400/55" aria-hidden />
        </div>
      )
    }
    return (
      <div
        data-testid="wc-chat-loading"
        className="flex min-h-0 flex-1 items-center gap-2 overflow-y-auto py-3 text-xs text-white/40"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading…
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error) {
    const isAiLimit = error.toLowerCase().includes("limit") || error.toLowerCase().includes("locked")
    return (
      <div
        data-testid="wc-chat-error"
        className="flex min-h-[10rem] flex-1 flex-col items-center justify-center rounded-2xl border border-rose-400/22 bg-rose-400/[0.06] px-4 py-5 text-center"
      >
        <p className="text-sm font-black text-rose-200/82">
          {isAiLimit ? "Chimmy is unavailable" : "Could not load messages"}
        </p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-white/40">
          {isAiLimit
            ? "This premium insight is unavailable. Try a bracket or pool question, or upgrade to AF Pro."
            : error}
        </p>
      </div>
    )
  }

  // ── Empty state: AI mode ──────────────────────────────────────────────────

  if (mode === "ai") {
    const prompts = (suggestedPrompts ?? AI_DEFAULT_PROMPTS).slice(0, 3)
    return (
      <div
        data-testid="wc-chat-empty-ai"
        className="flex min-h-[16rem] flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-cyan-300/18 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_42%),rgba(0,0,0,0.18)] px-4 py-6 text-center"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/[0.08] text-cyan-200">
          <Bot className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-black text-white/75">
            Ask Chimmy about your bracket
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-white/40">
            Your private AI helper. Ask about your path to first, what match matters most, or who you should root for.
          </p>
        </div>
        {onSuggestPrompt ? (
          <div className="flex flex-wrap justify-center gap-1.5">
            {prompts.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onSuggestPrompt(p.prompt)}
                className="rounded-full border border-cyan-300/18 bg-white/[0.04] px-3 py-1.5 text-[11px] font-black text-slate-100/72 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  // ── Empty state: DM mode ─────────────────────────────────────────────────

  if (mode === "dm") {
    return (
      <div
        data-testid="wc-chat-empty-dm"
        className="flex min-h-[14rem] flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-cyan-300/15 px-4 py-6 text-center"
      >
        <p className="text-sm font-black text-white/70">Start the private conversation.</p>
        <p className="mt-1 text-xs leading-5 text-white/38">
          Select pool members from the list to start a private thread.
        </p>
      </div>
    )
  }

  // ── Empty state: Pool mode ─────────────────────────────────────────────

  return (
    <div
      data-testid="wc-chat-empty-state"
      className="flex min-h-[14rem] flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-cyan-300/18 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.10),transparent_42%),rgba(0,0,0,0.22)] px-4 py-6 text-center sm:min-h-[18rem]"
    >
      <MessageSquare className="h-8 w-8 text-white/20" aria-hidden />
      <div>
        <p className="text-sm font-black text-white/75">
          No messages yet. Start the pool trash talk.
        </p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-white/40">
          Be the first to post a message, share a reaction, or create a poll.
        </p>
      </div>
    </div>
  )
}
