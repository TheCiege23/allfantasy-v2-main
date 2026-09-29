"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createPlayoffBracketChallengeClient } from "@/lib/playoffs/playoffClientApi"
import { defaultPlayoffChallengeConfig } from "@/lib/playoffs/playoffChallengeConfig"
import type { PlayoffSport } from "@/lib/playoffs/types"

export default function QuickCreatePlayoffPoolButton({
  sport,
  label,
}: {
  sport: PlayoffSport
  label: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function quickCreate() {
    setError(null)
    setPending(true)
    try {
      const result = await createPlayoffBracketChallengeClient({
        name: sport === "nba" ? "NBA Playoff Pool" : "NHL Playoff Pool",
        sport,
        seasonYear: new Date().getUTCFullYear(),
        isTestMode: false,
        visibility: "private",
        maxUsers: 50,
        bracketsPerUser: 1,
        scoringStyle: "standard",
        lockRule: "series_start",
        config: defaultPlayoffChallengeConfig(),
      })
      router.push(result.redirectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create playoff pool.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={quickCreate}
        disabled={pending}
        className="rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50"
        style={{ borderColor: "rgba(56,189,248,0.28)", color: "rgba(186,230,253,0.92)" }}
        data-testid={`quick-create-${sport}-pool-button`}
      >
        {pending ? "Creating..." : label}
      </button>
      {error ? (
        <p className="text-[11px] font-semibold text-rose-300" data-testid={`quick-create-${sport}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
