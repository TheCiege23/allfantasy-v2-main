"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react"
import { trackWcPoolCreated, trackWcFunnelEvent } from "@/lib/world-cup/worldCupFunnelAnalytics"
import { trackMetaEventsFromResponse } from "@/lib/meta-client"

const DRAFT_KEY = "af:world-cup:guest-pool-draft:v1"

type WcGuestPoolDraft = {
  poolName: string
  displayName: string
  poolType: "full_bracket" | "group_stage" | "bracket_and_group"
  privacy: "private" | "public"
  groupType: string
  source: string
  createdAt: string
}

function readDraft(): WcGuestPoolDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.poolName || !parsed?.displayName) return null
    return parsed as WcGuestPoolDraft
  } catch {
    return null
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // ignore
  }
}

type State =
  | { status: "loading" }
  | { status: "no_draft" }
  | { status: "creating"; draft: WcGuestPoolDraft }
  | { status: "error"; message: string; draft: WcGuestPoolDraft }

export default function WorldCupFinishClient() {
  const router = useRouter()
  const [state, setState] = useState<State>({ status: "loading" })

  useEffect(() => {
    const draft = readDraft()
    if (!draft) {
      setState({ status: "no_draft" })
      return
    }

    setState({ status: "creating", draft })

    async function createPool() {
      if (!draft) return

      try {
        const visibility = draft.privacy === "public" ? "public" : "private"
        const res = await fetch("/api/brackets/world-cup/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: draft.poolName,
            seasonYear: 2026,
            visibility,
            pickLockStrategy: "tournament_start",
            knockoutMode: "predictive",
            includeThirdPlace: draft.poolType !== "group_stage",
          }),
        })

        const data = await res.json()
        trackMetaEventsFromResponse(data)

        if (!res.ok) {
          setState({
            status: "error",
            message: data?.error ?? "Failed to create pool. Please try again.",
            draft,
          })
          return
        }

        const challengeId = data?.challengeId ?? data?.id ?? data?.challenge?.id
        if (!challengeId) {
          setState({
            status: "error",
            message: "Pool created but ID was missing. Check your pools on the hub.",
            draft,
          })
          return
        }

        clearDraft()
        trackWcPoolCreated(challengeId, draft.poolName)
        trackWcFunnelEvent("WorldCupPoolCreated", { challenge_id: challengeId })

        // Redirect into the existing WC shell with welcome=invite so the
        // invite-first overlay appears without requiring a separate route
        // (keeps Vercel route count within the 2048 limit).
        router.replace(`/brackets/world-cup/${challengeId}?welcome=invite`)
      } catch (err) {
        setState({
          status: "error",
          message: "Network error. Check your connection and try again.",
          draft,
        })
      }
    }

    createPool()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Loading ────────────────────────────────────────────────────────────────

  if (state.status === "loading" || state.status === "creating") {
    const name = state.status === "creating" ? state.draft.poolName : null
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-white">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
          </div>
          <h1 className="text-2xl font-black text-white">Creating your pool…</h1>
          {name && (
            <p className="text-sm text-white/60">
              Setting up <strong className="text-white">{name}</strong>
            </p>
          )}
          <p className="text-xs text-white/35">This takes just a moment.</p>
        </div>
      </main>
    )
  }

  // ── No draft ───────────────────────────────────────────────────────────────

  if (state.status === "no_draft") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_40%)]" />
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] text-3xl">
            🏆
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">No saved pool draft found</h1>
            <p className="mt-2 text-sm text-white/60">
              Your draft may have expired or been created on a different device.
            </p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <Link
              href="/world-cup/create"
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-cyan-200 to-cyan-400 px-6 py-3 text-sm font-black text-slate-950 shadow-[0_10px_30px_-8px_rgba(34,211,238,0.7)]"
            >
              Start a World Cup pool
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/brackets/world-cup"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-6 py-3 text-sm font-black text-white/70"
            >
              Go to World Cup hub
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (state.status === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-white">
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-red-400/30 bg-red-400/10">
            <AlertCircle className="h-8 w-8 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">Something went wrong</h1>
            <p className="mt-2 text-sm text-white/60">{state.message}</p>
          </div>
          <div className="flex flex-col gap-3 w-full">
            <button
              onClick={() => setState({ status: "creating", draft: state.draft })}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-cyan-200 to-cyan-400 px-6 py-3 text-sm font-black text-slate-950"
            >
              Try again
              <ArrowRight className="h-4 w-4" />
            </button>
            <Link
              href="/brackets/world-cup/create"
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-white/15 bg-white/[0.05] px-6 py-3 text-sm font-black text-white/70"
            >
              Create pool manually
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return null
}
