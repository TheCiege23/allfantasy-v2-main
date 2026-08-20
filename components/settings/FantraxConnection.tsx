"use client"

import { useEffect, useState } from "react"

/**
 * Fantrax connection — one field, one secret.
 *
 * Fantrax authenticates with a `userSecretId` the account holder copies from their own
 * Fantrax profile screen. No OAuth, no app registration, no approval. See
 * contracts/fantrax/ENDPOINTS.yaml.
 *
 * ⚠ THIS VALUE IS A LONG-LIVED USER CREDENTIAL. It is stored encrypted by
 * /api/league/auth, and the status endpoint only ever reports a boolean back — the
 * secret is never returned to the browser once saved, so this form cannot and does not
 * pre-fill it. Treat it like a password in the UI: type=password, no autocomplete, and
 * never put it in a URL.
 */

type FantraxStatus = { connected: boolean; updatedAt: string | null }

async function fetchFantraxStatus(): Promise<FantraxStatus> {
  const res = await fetch("/api/league/auth", { cache: "no-store" })
  if (!res.ok) return { connected: false, updatedAt: null }
  const data = await res.json().catch(() => null)
  const auths = Array.isArray(data?.auths) ? data.auths : []
  const fantrax = auths.find((a: { platform?: string }) => a.platform === "fantrax")
  // hasApiKey is the boolean the server exposes; the key itself never leaves the server.
  return { connected: Boolean(fantrax?.hasApiKey), updatedAt: fantrax?.updatedAt ?? null }
}

export function FantraxConnection() {
  const [status, setStatus] = useState<FantraxStatus>({ connected: false, updatedAt: null })
  const [secret, setSecret] = useState("")
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchFantraxStatus().then((s) => {
      if (cancelled) return
      setStatus(s)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    const value = secret.trim()
    if (!value) {
      setError("Paste your Fantrax Secret ID to connect.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/league/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "fantrax", apiKey: value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || "We could not save that Secret ID.")
        return
      }
      // Drop it from component state the moment it is stored — no reason to keep a
      // credential in memory after the round-trip that needed it.
      setSecret("")
      setEditing(false)
      setStatus(await fetchFantraxStatus())
    } catch {
      setError("We could not reach the server. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/league/auth", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "fantrax" }),
      })
      if (!res.ok) {
        setError("We could not disconnect Fantrax.")
        return
      }
      setStatus({ connected: false, updatedAt: null })
    } catch {
      setError("We could not reach the server. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="mt-3 space-y-2">
      {status.connected && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border px-2 py-0.5 text-xs font-semibold"
            style={{ borderColor: "var(--good)", color: "var(--good)" }}
          >
            Fantrax connected
          </span>
          {status.updatedAt ? (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              since {new Date(status.updatedAt).toLocaleDateString()}
            </span>
          ) : null}
          <button
            type="button"
            className="rounded-md border px-2 py-1 text-xs"
            style={{ borderColor: "var(--line)", color: "var(--text)" }}
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            Replace Secret ID
          </button>
          <button
            type="button"
            className="rounded-md border px-2 py-1 text-xs"
            style={{ borderColor: "var(--bad)", color: "var(--bad)" }}
            onClick={() => void disconnect()}
            disabled={busy}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs" style={{ color: "var(--muted)" }}>
            Fantrax Secret ID
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Paste your Secret ID"
              className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
              style={{ borderColor: "var(--line)", background: "var(--surface2)", color: "var(--text)" }}
            />
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-sm font-semibold"
              style={{ background: "var(--accent)", color: "#04121b" }}
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Connect"}
            </button>
            {status.connected ? (
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--line)", color: "var(--text)" }}
                onClick={() => {
                  setEditing(false)
                  setSecret("")
                  setError(null)
                }}
                disabled={busy}
              >
                Cancel
              </button>
            ) : null}
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Fantrax shows this on your profile screen. It lets us read your leagues — it is
            not your password, and we never post to Fantrax. Stored encrypted, and never
            shown back to you.
          </p>
        </div>
      )}

      {error ? (
        <p className="text-xs" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
