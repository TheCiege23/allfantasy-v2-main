"use client"

/**
 * WorldCupChatModeTabs
 *
 * Mode selector displayed at the top of the chat drawer.
 * Renders clear "Pool Chat | Ask Chimmy | DMs" tabs so users immediately
 * know what they're looking at (public vs private AI vs DMs).
 */

import { Bot, MessageSquare, Users } from "lucide-react"
import type { WorldCupChatMode } from "./worldCupChatTypes"

export type WorldCupChatModeTabsProps = {
  mode: WorldCupChatMode
  onModeChange: (mode: WorldCupChatMode) => void
  /** Override labels — defaults to English */
  labels?: {
    pool?: string
    ai?: string
    dm?: string
  }
  /** Show unread indicator on pool tab */
  poolUnread?: number
  /** Show AI available indicator on Chimmy tab */
  aiAvailable?: boolean
}

const MODE_CONFIG: Array<{
  mode: WorldCupChatMode
  defaultLabel: string
  icon: typeof MessageSquare
}> = [
  { mode: "pool", defaultLabel: "Pool Chat", icon: MessageSquare },
  { mode: "ai", defaultLabel: "Ask Chimmy", icon: Bot },
  { mode: "dm", defaultLabel: "DMs", icon: Users },
]

export function WorldCupChatModeTabs({
  mode,
  onModeChange,
  labels = {},
  poolUnread = 0,
  aiAvailable = false,
}: WorldCupChatModeTabsProps) {
  const labelMap: Record<WorldCupChatMode, string> = {
    pool: labels.pool ?? "Pool Chat",
    ai: labels.ai ?? "Ask Chimmy",
    dm: labels.dm ?? "DMs",
  }

  return (
    <div
      className="grid grid-cols-3 gap-0.5 rounded-full border border-white/10 bg-black/35 p-0.5"
      role="tablist"
      aria-label="Chat mode"
    >
      {MODE_CONFIG.map(({ mode: tabMode, icon: Icon }) => {
        const isActive = mode === tabMode
        const label = labelMap[tabMode]
        const showPoolBadge = tabMode === "pool" && poolUnread > 0
        const showAiBadge = tabMode === "ai" && aiAvailable

        return (
          <button
            key={tabMode}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`wc-chat-tab-${tabMode}`}
            onClick={() => onModeChange(tabMode)}
            className={[
              "relative inline-flex min-h-8 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[11px] font-black transition touch-manipulation sm:px-3 sm:text-[11px]",
              isActive
                ? tabMode === "ai"
                  ? "bg-gradient-to-r from-cyan-300 to-violet-400 text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.3)]"
                  : "bg-gradient-to-r from-amber-300 to-cyan-200 text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.22)]"
                : "text-white/50 hover:bg-white/[0.06] hover:text-white",
            ].join(" ")}
          >
            <Icon
              className={["h-3.5 w-3.5", isActive ? "" : "opacity-70"].join(" ")}
              aria-hidden
            />
            <span className="truncate">{label}</span>
            {/* Unread / available indicators */}
            {showPoolBadge ? (
              <span
                aria-label={`${poolUnread} unread`}
                className="absolute right-1 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-0.5 text-[11px] font-black text-slate-950"
              >
                {poolUnread > 9 ? "9+" : poolUnread}
              </span>
            ) : null}
            {showAiBadge && !isActive ? (
              <span
                aria-label="available"
                className="absolute right-1 top-0.5 h-2 w-2 rounded-full bg-cyan-400"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
