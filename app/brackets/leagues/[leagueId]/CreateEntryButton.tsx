"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Loader2, X } from "lucide-react"

export default function CreateEntryButton({
  leagueId,
  tiebreakerEnabled = false,
}: {
  leagueId: string
  tiebreakerEnabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [tiebreakerPoints, setTiebreakerPoints] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    setLoading(true)

    try {
      const payload: Record<string, unknown> = { leagueId, name: name.trim() }
      if (tiebreakerEnabled) {
        payload.tiebreakerPoints = tiebreakerPoints ? Number(tiebreakerPoints) : null
      }

      const res = await fetch("/api/bracket/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || data.error || "Failed to create entry")
        return
      }
      router.push(`/bracket/${data.tournamentId}/entry/${data.entryId}`)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        style={{ background: 'white', color: 'black' }}
        data-testid="bracket-create-entry-open-button"
      >
        <Plus className="h-3.5 w-3.5" />
        Create bracket
      </button>
    )
  }

  return (
    <div className="w-full mt-3 space-y-3">
      <form onSubmit={handleCreate} className="space-y-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My Bracket"
          disabled={loading}
          className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm outline-none focus:border-white/20"
          data-testid="bracket-create-entry-name-input"
        />

        {tiebreakerEnabled && (
          <input
            value={tiebreakerPoints}
            onChange={(e) => setTiebreakerPoints(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Championship total points tiebreaker (optional)"
            disabled={loading}
            inputMode="numeric"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm outline-none focus:border-white/20"
            data-testid="bracket-create-entry-tiebreak-input"
          />
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60 transition-colors"
            style={{ background: 'white', color: 'black' }}
            data-testid="bracket-create-entry-submit-button"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create"
            )}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null); setName(""); setTiebreakerPoints("") }}
            className="rounded-lg border border-white/10 p-1.5 hover:bg-white/10 transition"
          >
            <X className="h-4 w-4 text-white/60" />
          </button>
        </div>
      </form>

      {error && (
        <p className="mt-2 text-xs text-red-300">{error}</p>
      )}
    </div>
  )
}
