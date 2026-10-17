"use client"

/**
 * WorldCupAiPromptChips
 *
 * Scrollable row of contextual AI prompt suggestions shown at the top of the
 * chat drawer. Always visible (not mode-gated) so any user can quickly start
 * an AI conversation. Each chip fires a prompt into the AI composer.
 *
 * The prompts are computed by the parent (WorldCupCommunityFoundationPanel)
 * based on pool state: leaderboard available, user has entry, etc.
 */

import type { WorldCupAiPromptAction } from "./worldCupChatTypes"

export type WorldCupAiPromptChipsProps = {
  actions: WorldCupAiPromptAction[]
  onSelect: (prompt: string) => void
  /** Aria label for the scrollable region */
  regionLabel?: string
}

export function WorldCupAiPromptChips({
  actions,
  onSelect,
  regionLabel = "Suggested Chimmy prompts",
}: WorldCupAiPromptChipsProps) {
  if (actions.length === 0) return null

  return (
    <div
      aria-label={regionLabel}
      data-testid="wc-chat-prompt-chips"
      className="mx-2 mb-1 mt-2 flex shrink-0 flex-nowrap gap-1.5 overflow-x-auto pb-1 scrollbar-none sm:mx-3 sm:mb-2 sm:mt-2"
    >
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={() => onSelect(action.prompt)}
          className="inline-flex min-h-8 shrink-0 items-center rounded-full border border-cyan-300/15 bg-white/[0.045] px-3 py-1 text-[11px] font-black text-slate-100/78 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.08] hover:text-white touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:text-[11px]"
          data-testid={`wc-prompt-chip-${action.key}`}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
