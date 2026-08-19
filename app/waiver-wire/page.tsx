"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { WaiverWireClient } from "./WaiverWireClient"

export default function WaiverWirePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const leagueId = searchParams?.get("leagueId")
  
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/session")
        const data = await res.json()
        setIsAuthenticated(!!data.user)
      } catch (error) {
        console.error("Auth check failed:", error)
      } finally {
        setIsLoading(false)
      }
    }
    checkAuth()
  }, [])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="text-white/60">Loading waiver wire...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    router.push("/login")
    return null
  }

  if (!leagueId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a]">
        <div className="text-white/60">No league selected</div>
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-4 text-cyan-400 hover:text-cyan-300"
        >
          Go to Dashboard
        </button>
      </div>
    )
  }

  return <WaiverWireClient leagueId={leagueId} preselectPlayerId={searchParams?.get("playerId") ?? null} />
}