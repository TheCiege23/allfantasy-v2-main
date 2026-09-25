"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Hash, Megaphone, MessageCircle, Sparkles, User2, X } from "lucide-react"
import type { ChatTabId } from "@/types/chat"
import BroadcastModal from "@/components/commish/BroadcastModal"
import { ChimmyChatShell } from "@/components/chimmy"
import { LeagueConversation } from "@/components/core-app/comms/LeagueConversation"
import ThreadPanel, { type ThreadAskChimmy } from "@/components/core-app/comms/ThreadPanel"
import { DM_PRIVACY, HUDDLE_PRIVACY } from "@/components/core-app/comms/privacyCopy"
import { readAIContextFromSearchParams } from "@/lib/chimmy-chat"
import type { AIChatContext } from "@/lib/chimmy-chat"
import { buildChimmyToolDisplayContext } from "@/lib/chimmy-interface"
import { useAIAssistantAvailability } from "@/hooks/useAIAssistantAvailability"
import "@/components/core-app/af-comms.css"

/**
 * The league page's chat: League chat · Messages · Chimmy.
 *
 * 🛑 THIS RENDERED AVATARS AND NO TEXT, IN PRODUCTION. Every row went through
 * `components/chat/LeagueMessageRow.tsx`, a test stub — `RichMessageRenderer = () => null`,
 * `QUICK_EMOJIS = []`, `parseLeaguePollPayload = () => null` — whose body was the comment
 * "rest of message rendering omitted for brevity in test context". It was cut out of this
 * file on 2026-04-08 ("update", a3b27fb6b, on the pre-squash history) to make a test render,
 * and reached main inside the 2026-09-18 history squash (5e8a2a45e). The league page's chat
 * tab (`LeagueShell` → `LeagueChatSurface` → here) showed initials and blank space ever since.
 *
 * Now each tab is the component the comms drawer already uses, so the two cannot drift again:
 *   - League chat → `LeagueConversation` (bubbles, your side / their side, GIFs, photos by
 *     button / drop / paste, polls, reactions, reply, copy, edit/delete, pins, search, the
 *     draft room link).
 *   - Messages    → `ThreadPanel`, DMs and Huddles.
 *   - Chimmy      → the existing Chimmy shell.
 */

type Props = {
  leagueId: string
  leagueName?: string
  isCommissioner?: boolean
  /** Kept for callers; the panel is always open where it is mounted. */
  defaultOpen?: boolean
  onClose?: () => void
  className?: string
}

function buildDmChimmyPrompt(ask: ThreadAskChimmy): string {
  const lines = ask.recent.map((m) => `${m.name}: ${m.body}`).filter((line) => line.trim().length > 0)
  if (lines.length === 0) {
    return "Help me with trade, waiver, and draft strategy based on this direct conversation."
  }
  return [
    "Use this direct conversation as context and help with the best next fantasy move.",
    "",
    "Recent messages:",
    ...lines,
    "",
    "Give one clear recommendation and a backup option.",
  ].join("\n")
}

export default function LeagueChatPanel({
  leagueId,
  leagueName = "League",
  isCommissioner = false,
  onClose,
  className = "",
}: Props) {
  const { data: session } = useSession()
  const { enabled: aiAssistantEnabled, loading: aiAvailabilityLoading } = useAIAssistantAvailability()
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<ChatTabId>("league")
  const [threadKind, setThreadKind] = useState<"dm" | "group">("dm")
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [aiDmContext, setAiDmContext] = useState<AIChatContext | null>(null)
  /*
   * Bumped when a commissioner broadcast goes out, so the league conversation remounts and
   * shows it straight away instead of on the next poll.
   */
  const [conversationEpoch, setConversationEpoch] = useState(0)

  const chatSource = useMemo(() => {
    const value = searchParams?.get("source")?.trim()
    return value || null
  }, [searchParams])
  /* A Survivor tribe channel. Read and posted through the shared thread route, which checks membership. */
  const tribeSource = chatSource?.startsWith("tribe_") ? chatSource : null

  const aiContextFromUrl = useMemo(() => readAIContextFromSearchParams(searchParams ?? undefined), [searchParams])
  const aiContext = useMemo<AIChatContext>(
    () => ({
      ...aiContextFromUrl,
      ...aiDmContext,
      source: aiDmContext?.source ?? aiContextFromUrl.source,
    }),
    [aiContextFromUrl, aiDmContext],
  )
  const chimmyToolContext = useMemo(
    () =>
      buildChimmyToolDisplayContext({
        source: aiContext.source ?? null,
        leagueName: aiContext.leagueName ?? leagueName,
        sport: aiContext.sport ?? null,
      }),
    [aiContext.leagueName, aiContext.source, aiContext.sport, leagueName],
  )

  const askChimmyAboutThread = useCallback((ask: ThreadAskChimmy) => {
    setAiDmContext({
      source: "messages_dm_ai",
      conversationId: ask.threadId,
      privateMode: ask.threadType === "dm",
      prompt: buildDmChimmyPrompt(ask),
      strategyMode: "dm_chat_review",
    })
    setActiveTab("ai")
  }, [])

  const tabs: { id: ChatTabId; label: string; icon: React.ReactNode }[] = [
    { id: "league", label: "League Chat", icon: <Hash className="h-3.5 w-3.5" /> },
    { id: "dm", label: "Messages", icon: <User2 className="h-3.5 w-3.5" /> },
    { id: "ai", label: "Chimmy", icon: <Sparkles className="h-3.5 w-3.5" /> },
  ]

  return (
    <section
      className={`flex min-h-0 flex-col rounded-2xl border shadow-xl ${className}`}
      style={{ borderColor: "var(--border)", background: "var(--panel)" }}
      aria-label="League chat"
      data-testid="league-chat-panel"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle className="h-5 w-5 shrink-0" style={{ color: "var(--accent-cyan-strong)" }} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" style={{ color: "var(--text)" }}>
              {leagueName}
            </p>
            <p className="text-[10px]" style={{ color: "var(--muted2)" }}>
              {tribeSource ? "Tribe chat · Messages · Chimmy" : "League chat · Messages · Chimmy"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/*
            @everyone for commissioners: the multi-league broadcast modal, this league
            pre-selected. The server re-checks commissioner status on send.
          */}
          {isCommissioner && !tribeSource ? (
            <button
              type="button"
              onClick={() => setBroadcastOpen(true)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold"
              style={{ borderColor: "var(--border)", color: "var(--accent-amber-strong)" }}
              title="Send to @everyone"
              aria-label="Send to @everyone"
              data-testid="composer-broadcast-open"
            >
              <Megaphone className="h-4 w-4" />
              <span className="hidden sm:inline">@everyone</span>
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border p-1.5"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--muted)" }}
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex border-b px-2 py-1" style={{ borderColor: "var(--border)" }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors"
            style={{
              background: activeTab === tab.id ? "color-mix(in srgb, var(--accent-cyan-strong) 12%, transparent)" : "transparent",
              color: activeTab === tab.id ? "var(--accent-cyan-strong)" : "var(--muted2)",
            }}
          >
            {tab.icon}
            <span className="sr-only sm:not-sr-only">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === "league" ? (
        <div className="af-cm af-cm-embed" data-testid="league-chat-conversation">
          <LeagueConversation
            key={`${leagueId}:${tribeSource ?? ""}:${conversationEpoch}`}
            leagueId={leagueId}
            leagueName={leagueName}
            isCommissioner={isCommissioner}
            viewerId={currentUserId}
            surface="page"
            source={tribeSource}
          />
        </div>
      ) : null}

      {activeTab === "dm" ? (
        <div className="af-cm af-cm-embed" data-testid="league-chat-messages">
          <div className="af-cm-kindswitch" role="group" aria-label="Conversations">
            <button
              type="button"
              className="af-cm-draft-toggle"
              data-on={threadKind === "dm"}
              aria-pressed={threadKind === "dm"}
              onClick={() => setThreadKind("dm")}
            >
              DMs
            </button>
            <button
              type="button"
              className="af-cm-draft-toggle"
              data-on={threadKind === "group"}
              aria-pressed={threadKind === "group"}
              onClick={() => setThreadKind("group")}
            >
              Huddles
            </button>
          </div>
          <ThreadPanel
            key={threadKind}
            kind={threadKind}
            privacy={threadKind === "dm" ? DM_PRIVACY : HUDDLE_PRIVACY}
            onAskChimmy={aiAssistantEnabled || aiAvailabilityLoading ? askChimmyAboutThread : undefined}
          />
        </div>
      ) : null}

      {activeTab === "ai" ? (
        <div className="min-h-0 flex-1 p-2">
          {aiAssistantEnabled || aiAvailabilityLoading ? (
            <ChimmyChatShell
              initialPrompt={aiContext.prompt ?? ""}
              clearUrlPromptAfterUse
              leagueName={leagueName}
              leagueId={aiContext.leagueId ?? leagueId}
              insightType={aiContext.insightType}
              teamId={aiContext.teamId ?? null}
              sport={aiContext.sport ?? null}
              season={aiContext.season ?? null}
              week={aiContext.week ?? null}
              conversationId={aiContext.conversationId ?? null}
              privateMode={Boolean(aiContext.privateMode)}
              targetUsername={aiContext.targetUsername ?? null}
              strategyMode={aiContext.strategyMode ?? null}
              source={aiContext.source}
              toolContext={chimmyToolContext}
              compact
              className="h-full min-h-[360px]"
            />
          ) : (
            <div
              data-testid="league-chat-ai-fallback"
              className="min-h-[360px] rounded-xl border p-4"
              style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
            >
              <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Chimmy&apos;s taking a breather
              </h3>
              <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
                League chat and your DMs still work. The waiver planner and trade finder don&apos;t need Chimmy — go get your edge.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/waiver-ai?leagueId=${encodeURIComponent(leagueId)}`}
                  className="rounded-md border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Open waiver planner
                </Link>
                <Link
                  href={`/trade-finder?leagueId=${encodeURIComponent(leagueId)}`}
                  className="rounded-md border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  Open trade finder
                </Link>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {isCommissioner && !tribeSource ? (
        <BroadcastModal
          open={broadcastOpen}
          onClose={() => {
            setBroadcastOpen(false)
            setConversationEpoch((n) => n + 1)
          }}
          defaultLeagueId={leagueId}
        />
      ) : null}
    </section>
  )
}
