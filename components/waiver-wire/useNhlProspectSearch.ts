"use client"

import { useEffect, useState } from "react"
import { shouldSearchNhlProspects, type NhlProspectListMeta } from "@/lib/waiver-wire/prospectFreeAgentDisplay"

/**
 * NHL dynasty free agency: the list carries the first few hundred Fantrax prospects, and a name search
 * asks the server for the rest (`/players?prospectsOnly=1&q=`). Does nothing unless the list said more
 * prospects exist than it holds, so every other league makes no extra request.
 */
export function useNhlProspectSearch<T>(leagueId: string | null | undefined, meta: NhlProspectListMeta | null, query: string): T[] {
  const [rows, setRows] = useState<T[]>([])
  const q = query.trim()
  const active = Boolean(leagueId) && shouldSearchNhlProspects(meta, q)
  useEffect(() => {
    if (!active || !leagueId) {
      setRows([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`/api/waiver-wire/leagues/${leagueId}/players?prospectsOnly=1&q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled) setRows(Array.isArray(data?.players) ? (data.players as T[]) : [])
        })
        .catch(() => {
          if (!cancelled) setRows([])
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [active, leagueId, q])
  return rows
}
