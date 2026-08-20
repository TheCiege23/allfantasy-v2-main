"use client"

import { type FormEvent, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { createPlayoffBracketChallengeClient } from "@/lib/playoffs/playoffClientApi"
import { officialNhlPlayoffUiPresentation } from "@/lib/playoffs/playoffBracketDataSource"

export default function NhlPlayoffPoolCreatePage() {
  const router = useRouter()
  const defaultYear = new Date().getFullYear()
  const [name, setName] = useState("")
  const [seasonYear, setSeasonYear] = useState<number>(defaultYear)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nhlBracketMode = useMemo(() => officialNhlPlayoffUiPresentation(), [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await createPlayoffBracketChallengeClient({
        name: name.trim() || undefined,
        sport: "nhl",
        seasonYear: Math.max(2024, Math.min(2100, seasonYear || defaultYear)),
        isTestMode: false,
      })
      router.push(result.redirectUrl ?? `/brackets/leagues/${result.challengeId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pool")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6 lg:px-10">
        <Link href="/brackets/nhl" className="text-xs font-bold text-white/50 hover:text-white/80">
          ← NHL Playoff Pools
        </Link>
        <h1 className="mt-6 text-2xl font-black tracking-tight sm:text-3xl">Create NHL Playoff Pool</h1>
        {nhlBracketMode === "lab_template" ? (
          <>
            <p className="mt-2 text-sm font-semibold text-amber-200/90">
              Using test/template NHL bracket until official playoff sync is connected. Pools are playable for picks; teams are illustrative, not current league postseason seeding.
            </p>
            <p className="mt-2 text-xs text-white/45">
              Source: deterministic template (<code className="text-white/60">buildPlayoffTemplate</code>). Not live NHL postseason data.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-emerald-200/90">
            Official NHL bracket sync flag is on. If matchups still look template-based, ingestion may still be rolling out — check release notes.
          </p>
        )}
        <p className="mt-2 text-sm text-white/55">
          Multiple bracket entries per user are supported after you open the pool dashboard.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div>
            <label htmlFor="nhl-pool-name" className="text-xs font-bold uppercase tracking-wide text-white/50">
              Pool name
            </label>
            <input
              id="nhl-pool-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="NHL Playoff Pool"
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30"
              autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="nhl-season" className="text-xs font-bold uppercase tracking-wide text-white/50">
              Season year
            </label>
            <input
              id="nhl-season"
              type="number"
              min={2024}
              max={2100}
              value={seasonYear}
              onChange={(e) => setSeasonYear(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </div>
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl bg-sky-400 px-4 py-2.5 text-sm font-black text-black disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? "Creating…" : "Create pool"}
          </button>
        </form>
      </div>
    </main>
  )
}
