"use client"

import { useState, useEffect } from "react"
import { MessageCircle } from "lucide-react"
import LeagueChatPanel from "@/components/chat/LeagueChatPanel"

type Props = {
  leagueId: string
  leagueName?: string
  isCommissioner?: boolean
}

/**
 * Persistent league chat dock: stays open while navigating league pages.
 * Renders a launcher button when closed; when open, shows LeagueChatPanel.
 */
export default function LeagueChatDock({
  leagueId,
  leagueName,
  isCommissioner,
}: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(leagueName ?? "League")

  useEffect(() => {
    if (leagueName) setName(leagueName)
  }, [leagueName])

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 flex items-center gap-2 rounded-full border px-3 py-2.5 text-xs font-semibold shadow-lg md:bottom-6 md:right-6"
          style={{
            borderColor: "var(--border)",
            background: "var(--panel)",
            color: "var(--text)",
          }}
          aria-label="Open league chat"
        >
          <MessageCircle className="h-4 w-4" style={{ color: "var(--accent-cyan-strong)" }} />
          <span className="hidden sm:inline">League Chat</span>
        </button>
      )}
      {open && (
        <div
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 w-[min(100vw-2rem,400px)] md:bottom-6 md:right-6 md:max-h-[calc(100vh-8rem)]"
          role="dialog"
          aria-label="League chat"
        >
          <LeagueChatPanel
            leagueId={leagueId}
            leagueName={name}
            isCommissioner={isCommissioner}
            onClose={() => setOpen(false)}
            className="max-h-[85vh] md:max-h-[calc(100vh-8rem)]"
          />
        </div>
      )}
    </>
  )
}
