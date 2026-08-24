"use client"

import Link from "next/link"
import { useState } from "react"

/**
 * The actual Sleeper linker. The page this replaces was a circular dead-end:
 * it said "link your account by importing a league" while the import pipeline's
 * commissioner gate REQUIRES the link — so a direct signup could never get
 * through. Discovery (/api/leagues/import/discover) both validates the handle
 * against Sleeper and stamps sleeperUserId/sleeperUsername on the profile
 * (first-write-wins), so one submit here unblocks the whole import funnel.
 */
export default function ConnectSleeperForm() {
  const [username, setUsername] = useState("")
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "linked"; displayName: string; leagueCount: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const handle = username.trim()
    if (handle.length < 2) {
      setState({ kind: "error", message: "Enter your Sleeper username." })
      return
    }
    setState({ kind: "loading" })
    try {
      const res = await fetch("/api/leagues/import/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "sleeper", accountIdentifier: handle }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        account?: { displayName?: string }
        leagues?: unknown[]
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message:
            typeof data.error === "string" && data.error
              ? data.error
              : "We couldn't reach Sleeper. Try again shortly.",
        })
        return
      }
      setState({
        kind: "linked",
        displayName: data.account?.displayName || handle,
        leagueCount: Array.isArray(data.leagues) ? data.leagues.length : 0,
      })
    } catch {
      setState({ kind: "error", message: "Something went wrong. Try again." })
    }
  }

  if (state.kind === "linked") {
    return (
      <div className="mt-6 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5">
        <p className="text-sm font-semibold text-emerald-300">
          Linked as {state.displayName}
        </p>
        <p className="mt-1 text-sm text-white/60">
          {state.leagueCount > 0
            ? `Found ${state.leagueCount} league${state.leagueCount === 1 ? "" : "s"} on this account this season.`
            : "No leagues found for the current season yet — the link is saved either way."}
        </p>
        <Link
          href="/import?provider=sleeper"
          className="mt-4 inline-flex rounded-xl bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/30"
        >
          Import your leagues
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/45">
          Sleeper username
        </span>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your_sleeper_username"
          autoComplete="off"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
        />
      </label>
      {state.kind === "error" ? (
        <p className="text-sm text-rose-300" role="alert">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state.kind === "loading"}
        className="rounded-xl bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50"
      >
        {state.kind === "loading" ? "Checking Sleeper…" : "Link Sleeper account"}
      </button>
      <p className="text-xs text-white/40">
        Read-only. We never post, change rosters, or ask for your Sleeper password.
      </p>
    </form>
  )
}
