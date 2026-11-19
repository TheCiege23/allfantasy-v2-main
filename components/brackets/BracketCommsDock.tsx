"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"
import dynamic from "next/dynamic"
import { toPlayedLeagues } from "@/lib/core-app/playedLeagues"
import type { CommsLeague } from "@/components/core-app/comms/CommsDrawer"
import "@/components/core-app/af-core.css"
import "./bracket-comms.css"

const CommsDock = dynamic(() => import("@/components/core-app/comms/CommsDock"), { ssr: false })
const subscribe = () => () => {}
const browserSnapshot = () => true
const serverSnapshot = () => false

function leagueRows(value: unknown): CommsLeague[] {
  if (!Array.isArray(value)) throw new Error("Invalid league list")
  const rows = value.filter((row): row is Record<string, unknown> =>
    Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string" && typeof (row as { name?: unknown }).name === "string",
  )
  return toPlayedLeagues(rows).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    platform: typeof row.platform === "string" ? row.platform.toLowerCase() : "manual",
    platformLeagueId: typeof row.platformLeagueId === "string" ? row.platformLeagueId : null,
    isCommissioner: row.isCommissioner === true,
    teamCount: typeof row.teamCount === "number" && Number.isFinite(row.teamCount) ? row.teamCount : 0,
  }))
}

function SignedInBracketComms({ email, tokenCost }: { email: string | null; tokenCost: number | null }) {
  const [leagues, setLeagues] = useState<CommsLeague[]>([])
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/league/list?summary=1", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("League list unavailable")
        return response.json() as Promise<{ leagues?: unknown }>
      })
      .then((payload) => { if (!controller.signal.aborted) setLeagues(leagueRows(payload.leagues)) })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true) })
    return () => controller.abort()
  }, [])

  return <div className="af-core">
    {unavailable ? <p role="status" className="af-bracket-comms-status">Your fantasy leagues couldn't load. Refresh to try again.</p> : null}
    <CommsDock leagues={leagues} pageLeagueId={null} chimmyTokenCost={tokenCost} supportEmail={email} />
  </div>
}

/** Keep the bracket layout safe to server-render; the existing dock is client-only. */
export default function BracketCommsDock({ tokenCost }: { tokenCost: number | null }) {
  const mounted = useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot)
  const { data: session, status } = useSession()
  const userId = session?.user?.id
  const lastUser = useRef<{ id: string; email: string | null } | null>(null)
  if (status === "unauthenticated") lastUser.current = null
  else if (status === "authenticated" && userId) lastUser.current = { id: userId, email: session.user?.email ?? null }
  if (!mounted || !lastUser.current) return null
  return <SignedInBracketComms key={lastUser.current.id} email={lastUser.current.email} tokenCost={tokenCost} />
}

