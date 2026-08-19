"use client"

import { useEffect, useState } from "react"

type EspnAuthStatus = {
  connected: boolean
  updatedAt: string | null
}

async function fetchEspnAuthStatus(): Promise<EspnAuthStatus> {
  const res = await fetch("/api/league/auth", { cache: "no-store" })
  if (!res.ok) return { connected: false, updatedAt: null }
  const data = await res.json().catch(() => null)
  const auths = Array.isArray(data?.auths) ? data.auths : []
  const espn = auths.find((a: { platform?: string }) => a.platform === "espn")
  return {
    connected: Boolean(espn?.hasEspnCookies),
    updatedAt: espn?.updatedAt ?? null,
  }
}

// Set once the AllFantasy Connect ESPN extension is published (see extension/README.md).
// Until then this is empty and the extension path is simply never offered — the manual
// paste form below is unaffected either way.
const EXTENSION_ID = process.env.NEXT_PUBLIC_ESPN_EXTENSION_ID?.trim() || null

type ExtensionMessageResponse = { ok: boolean; code?: string; message?: string } | null

type ChromeRuntimeLike = {
  sendMessage: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void
  lastError?: { message?: string } | null
}

function getChromeRuntime(): ChromeRuntimeLike | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { chrome?: { runtime?: ChromeRuntimeLike } }
  return w.chrome?.runtime ?? null
}

/** Messages the Connect-ESPN extension; resolves null (never rejects) if it isn't reachable. */
function sendExtensionMessage(message: { type: string }): Promise<ExtensionMessageResponse> {
  return new Promise((resolve) => {
    const runtime = getChromeRuntime()
    if (!runtime || !EXTENSION_ID) {
      resolve(null)
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(null)
      }
    }, 2500)
    try {
      runtime.sendMessage(EXTENSION_ID, message, (response) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (runtime.lastError) {
          resolve(null)
          return
        }
        resolve((response ?? null) as ExtensionMessageResponse)
      })
    } catch {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve(null)
      }
    }
  })
}

/**
 * Connect ESPN — SWID + espn_s2 cookie form, plus a one-click path via the AllFantasy browser
 * extension when it's installed. ESPN has no OAuth/username discovery; a private league can only
 * be previewed/imported once these two cookies are saved for the signed-in user (read by
 * lib/league-import/espn/EspnLeagueFetchService.ts via the existing encrypted LeagueAuth
 * storage). Public leagues never need this — see the empty-cookie fallback in loadEspnLeagueRaw,
 * which is untouched by this form.
 */
export function EspnCookieConnection() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading")
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [swid, setSwid] = useState("")
  const [espnS2, setEspnS2] = useState("")
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null)

  const [extensionStatus, setExtensionStatus] = useState<"checking" | "detected" | "not-installed">(
    EXTENSION_ID ? "checking" : "not-installed",
  )
  const [oneClickConnecting, setOneClickConnecting] = useState(false)
  const [oneClickError, setOneClickError] = useState<string | null>(null)

  const refresh = async () => {
    const s = await fetchEspnAuthStatus()
    setStatus(s.connected ? "connected" : "disconnected")
    setUpdatedAt(s.updatedAt)
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (!EXTENSION_ID) return
    void sendExtensionMessage({ type: "ping" }).then((res) => {
      setExtensionStatus(res?.ok ? "detected" : "not-installed")
    })
  }, [])

  const handleOneClickConnect = async () => {
    setOneClickError(null)
    setOneClickConnecting(true)
    try {
      const res = await sendExtensionMessage({ type: "connectEspn" })
      if (!res) {
        setOneClickError("Could not reach the extension. Try the manual option below.")
        return
      }
      if (!res.ok) {
        setOneClickError(res.message || "Could not connect ESPN. Please try again.")
        return
      }
      setEditing(false)
      setMessage({ tone: "success", text: "ESPN connected. Private leagues can now be previewed and imported." })
      await refresh()
    } finally {
      setOneClickConnecting(false)
    }
  }

  const handleSave = async () => {
    const trimmedSwid = swid.trim()
    const trimmedS2 = espnS2.trim()
    if (!trimmedSwid || !trimmedS2) {
      setMessage({ tone: "error", text: "Enter both the SWID and espn_s2 cookie values." })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/league/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "espn", espnSwid: trimmedSwid, espnS2: trimmedS2 }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage({ tone: "error", text: data?.error || "Could not save ESPN cookies. Please try again." })
        return
      }
      setSwid("")
      setEspnS2("")
      setEditing(false)
      setMessage({ tone: "success", text: "ESPN connected. Private leagues can now be previewed and imported." })
      await refresh()
    } catch {
      setMessage({ tone: "error", text: "Network error — please try again." })
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (typeof window !== "undefined" && !window.confirm("Disconnect ESPN? Private ESPN leagues won't import until you reconnect.")) {
      return
    }
    setDisconnecting(true)
    setMessage(null)
    try {
      const res = await fetch("/api/league/auth", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "espn" }),
      })
      if (!res.ok) {
        setMessage({ tone: "error", text: "Could not disconnect ESPN. Please try again." })
        return
      }
      setMessage({ tone: "success", text: "ESPN disconnected." })
      await refresh()
    } catch {
      setMessage({ tone: "error", text: "Network error — please try again." })
    } finally {
      setDisconnecting(false)
    }
  }

  if (status === "loading") {
    return <p className="text-xs" style={{ color: "var(--muted)" }}>Checking ESPN connection…</p>
  }

  const showForm = status === "disconnected" || editing
  const showOneClick = showForm && extensionStatus === "detected"

  const manualFormFields = (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Private ESPN leagues need two cookies from your browser. Open{" "}
        <span style={{ color: "var(--text)" }}>fantasy.espn.com</span> signed in, open dev tools (F12) →{" "}
        <span style={{ color: "var(--text)" }}>Application</span> →{" "}
        <span style={{ color: "var(--text)" }}>Cookies</span> → find <span style={{ color: "var(--text)" }}>SWID</span> and{" "}
        <span style={{ color: "var(--text)" }}>espn_s2</span>, and paste them here. Stored securely; used only to
        read your ESPN leagues.
      </p>
      <div className="space-y-1">
        <label htmlFor="espn-swid-input" className="text-xs font-medium" style={{ color: "var(--muted2)" }}>
          SWID
        </label>
        <input
          id="espn-swid-input"
          type="password"
          autoComplete="off"
          placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
          value={swid}
          onChange={(e) => setSwid(e.target.value)}
          disabled={saving}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="espn-s2-input" className="text-xs font-medium" style={{ color: "var(--muted2)" }}>
          espn_s2
        </label>
        <input
          id="espn-s2-input"
          type="password"
          autoComplete="off"
          placeholder="Long cookie value"
          value={espnS2}
          onChange={(e) => setEspnS2(e.target.value)}
          disabled={saving}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !swid.trim() || !espnS2.trim()}
          className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--accent-cyan)", color: "var(--on-accent-bg, #04121a)" }}
        >
          {saving ? "Saving…" : "Save ESPN cookies"}
        </button>
        {status === "connected" && (
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setSwid("")
              setEspnS2("")
              setMessage(null)
            }}
            disabled={saving}
            className="rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className="w-full space-y-2">
      {status === "connected" && !editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{ borderColor: "#10b981", color: "#10b981" }}
          >
            ESPN connected
          </span>
          {updatedAt && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              since {new Date(updatedAt).toLocaleDateString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            Update cookies
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={disconnecting}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--accent-red)", color: "var(--accent-red-strong)" }}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      ) : null}

      {showForm && (
        <>
          {showOneClick && (
            <div
              className="space-y-2 rounded-xl border p-3"
              style={{ borderColor: "var(--accent-cyan)", background: "var(--panel)" }}
              data-testid="espn-one-click-connect"
            >
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                The AllFantasy extension is installed. It reads only your ESPN league cookies
                (SWID and espn_s2), encrypted, to import your leagues — nothing else.
              </p>
              <button
                type="button"
                onClick={() => void handleOneClickConnect()}
                disabled={oneClickConnecting}
                className="w-full rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--accent-cyan)", color: "var(--on-accent-bg, #04121a)" }}
              >
                {oneClickConnecting ? "Connecting…" : "Connect with 1 click"}
              </button>
              {oneClickError && (
                <p className="text-xs" style={{ color: "var(--accent-red-strong)" }}>
                  {oneClickError}
                </p>
              )}
              <details className="text-xs" style={{ color: "var(--muted)" }}>
                <summary className="cursor-pointer select-none" style={{ color: "var(--muted2)" }}>
                  Or paste cookies manually instead
                </summary>
                <div className="mt-2">{manualFormFields}</div>
              </details>
            </div>
          )}

          {!showOneClick && manualFormFields}

          {/* Only nudge toward the extension once it's actually published (EXTENSION_ID set) —
              otherwise there's nothing to install yet, so say nothing extra here. */}
          {EXTENSION_ID && extensionStatus === "not-installed" && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Install the AllFantasy browser extension for one-click ESPN connect — no dev tools
              needed.
            </p>
          )}
        </>
      )}

      {message && (
        <p className="text-xs" style={{ color: message.tone === "error" ? "var(--accent-red-strong)" : "#10b981" }}>
          {message.text}
        </p>
      )}

      <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
        On mobile? Connect ESPN once on a desktop browser — it stays saved on your account after
        that.
      </p>
    </div>
  )
}
