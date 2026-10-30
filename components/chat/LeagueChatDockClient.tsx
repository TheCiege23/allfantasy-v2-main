"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { usesDynastyBackground } from "@/lib/league-media/dynastyBackground"
import LeagueChatDock from "@/components/chat/LeagueChatDock"

/**
 * Client wrapper that reads leagueId from route params and renders the persistent chat dock.
 * Used in app/app/league/[leagueId]/layout.tsx so chat stays open when navigating league tabs.
 */
export default function LeagueChatDockClient() {
  const params = useParams<{ leagueId: string }>()
  const leagueId = params?.leagueId ?? ""
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [dynastyBackground, setDynastyBackground] = useState(false)

  useEffect(() => {
    let active = true
    async function loadCommissionerStatus() {
      if (!leagueId) return
      try {
        const res = await fetch(`/api/commissioner/leagues/${encodeURIComponent(leagueId)}/check`, {
          cache: "no-store",
        })
        const json = await res.json().catch(() => ({}))
        if (active) setIsCommissioner(Boolean(json?.isCommissioner))
      } catch {
        if (active) setIsCommissioner(false)
      }
    }
    setDynastyBackground(false)
    if (leagueId) {
      fetch(`/api/leagues/${encodeURIComponent(leagueId)}`, { cache: "no-store" })
        .then(res => res.ok ? res.json() : null)
        .then(league => { if (active && league) setDynastyBackground(usesDynastyBackground(league)) })
        .catch(() => {})
    }
    void loadCommissionerStatus()
    return () => {
      active = false
    }
  }, [leagueId])

  if (!leagueId) return null

  return (
    <LeagueChatDock
      leagueId={leagueId}
      dynastyBackground={dynastyBackground}
      isCommissioner={isCommissioner}
    />
  )
}
