"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle, Loader2, Trophy } from "lucide-react"

export default function WorldCupBracketCreateModal() {
  const router = useRouter()
  const [name, setName] = useState("World Cup Bracket Challenge")
  const [visibility, setVisibility] = useState<"private" | "public">("private")
  const [lockStrategy, setLockStrategy] = useState<"per_match" | "tournament_start">("per_match")
  const [includeThirdPlace, setIncludeThirdPlace] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<"idle" | "creating" | "opening">("idle")
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    setStatus("creating")

    try {
      const res = await fetch("/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, seasonYear: 2026, visibility, pickLockStrategy: lockStrategy, includeThirdPlace }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        throw new Error("Please sign in to create a bracket.")
      }
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`)
      }

      const createdId =
        data?.challengeId ??
        data?.id ??
        data?.challenge?.id ??
        (data?.challenge as any)?.challengeId

      if (!createdId) {
        throw new Error("Bracket was created but the server did not return an ID. Please refresh the page.")
      }

      setStatus("opening")
      router.push(`/brackets/world-cup/${createdId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bracket")
      setStatus("idle")
    } finally {
      setLoading(false)
    }
  }

  const submitLabel =
    status === "creating"
      ? "Creating…"
      : status === "opening"
        ? "Created bracket, opening…"
        : "Create Challenge"

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#05070b] text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-white/10 bg-white/[0.04] p-2"
          aria-label="Go back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-black">Create FIFA World Cup Bracket</h1>
          <p className="text-xs text-white/45">Full-screen challenge setup</p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8">
        <form onSubmit={submit} className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-cyan-300 p-3 text-black">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-black text-white">2026 FIFA World Cup</div>
              <div className="text-xs text-white/45">Round of 32 knockout bracket with placeholders</div>
            </div>
          </div>

          <label className="text-xs font-black uppercase tracking-[0.16em] text-white/45">
            Challenge Name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-sm font-bold text-white outline-none focus:border-cyan-300/60"
            required
            maxLength={80}
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setVisibility("private")}
              className={`rounded-lg border p-3 text-left ${visibility === "private" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"}`}
            >
              <div className="text-sm font-black">Private</div>
              <div className="text-xs text-white/45">Invite link required</div>
            </button>
            <button
              type="button"
              onClick={() => setVisibility("public")}
              className={`rounded-lg border p-3 text-left ${visibility === "public" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"}`}
            >
              <div className="text-sm font-black">Public</div>
              <div className="text-xs text-white/45">Visible to users</div>
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setLockStrategy("per_match")}
              className={`rounded-lg border p-3 text-left ${lockStrategy === "per_match" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"}`}
            >
              <div className="text-sm font-black">Per Match Lock</div>
              <div className="text-xs text-white/45">Locks at kickoff</div>
            </button>
            <button
              type="button"
              onClick={() => setLockStrategy("tournament_start")}
              className={`rounded-lg border p-3 text-left ${lockStrategy === "tournament_start" ? "border-cyan-300/60 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]"}`}
            >
              <div className="text-sm font-black">Tournament Lock</div>
              <div className="text-xs text-white/45">Locks all at once</div>
            </button>
          </div>

          <label className="mt-5 flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm font-bold text-white/75">
            <input
              type="checkbox"
              checked={includeThirdPlace}
              onChange={(e) => setIncludeThirdPlace(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Include third-place match
          </label>

          {status === "opening" && !error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-3 text-sm text-cyan-100">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Created bracket, opening…
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 py-3 text-sm font-black text-black disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
            {submitLabel}
          </button>
        </form>
      </main>
    </div>
  )
}

