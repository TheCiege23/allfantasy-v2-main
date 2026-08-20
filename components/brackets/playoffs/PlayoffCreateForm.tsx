"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createPlayoffBracketChallengeClient } from "@/lib/playoffs/playoffClientApi"

type Props = {
  initialSport?: "nba" | "nhl"
}

export default function PlayoffCreateForm({ initialSport }: Props = {}) {
  const router = useRouter()
  const [name, setName] = useState("Championship Chase")
  const [sport, setSport] = useState<"nba" | "nhl">(initialSport ?? "nba")
  const [isTestMode, setIsTestMode] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await createPlayoffBracketChallengeClient({
          name,
          sport,
          seasonYear: new Date().getUTCFullYear(),
          isTestMode,
        })
        toast.success(`${result.name} created.`)
        router.push(result.redirectUrl ?? `/brackets/leagues/${result.challengeId}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to create playoff challenge"
        setError(message)
        toast.error(message)
      }
    })
  }

  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-slate-300 bg-[linear-gradient(160deg,#fff7ed_0%,#ecfeff_50%,#eef2ff_100%)] p-6 shadow-[0_18px_48px_rgba(15,23,42,0.16)]">
      <h1 className="text-2xl font-black tracking-tight text-slate-900">Create a Playoff Bracket</h1>
      <p className="mt-1 text-sm text-slate-700">Launch an NBA or NHL bracket pool using the shared playoff engine.</p>

      <label className="mt-4 block text-sm font-semibold text-slate-800">Challenge name</label>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
      />

      <label className="mt-4 block text-sm font-semibold text-slate-800">Sport</label>
      <select
        value={sport}
        onChange={(event) => setSport(event.target.value as "nba" | "nhl")}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-500"
      >
        <option value="nba">NBA</option>
        <option value="nhl">NHL</option>
      </select>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={isTestMode} onChange={(event) => setIsTestMode(event.target.checked)} />
        Seed with current playoff teams
      </label>

      {error ? <p className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm font-medium text-rose-800">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={isPending || name.trim().length < 2}
        className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Creating..." : "Create Pool"}
      </button>
    </div>
  )
}
