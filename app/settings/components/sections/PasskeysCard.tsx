"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { addPasskey, canUsePasskeys, deviceUnlockName } from "@/lib/auth/passkey-client"
import { UnlockIcon } from "@/components/auth/PasskeySignInButton"

type SavedPasskey = { id: string; label: string | null; createdAt: string; lastUsedAt: string | null }

function day(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

/**
 * Settings → Security: "Sign in with Face ID". Lists the devices set up for this account and adds
 * this one. Shown in the iOS app too, so a passkey made on the website can be removed there, but
 * the add button only appears on a device that can make one (lib/auth/passkey-client).
 */
export default function PasskeysCard() {
  const [passkeys, setPasskeys] = useState<SavedPasskey[] | null>(null)
  const [canAdd, setCanAdd] = useState(false)
  const [unlock, setUnlock] = useState("Face ID")
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/user/passkeys", { cache: "no-store" })
      const data = (await res.json().catch(() => ({}))) as { passkeys?: SavedPasskey[] }
      setPasskeys(res.ok && Array.isArray(data.passkeys) ? data.passkeys : [])
    } catch {
      setPasskeys([])
    }
  }, [])

  useEffect(() => {
    void load()
    setUnlock(deviceUnlockName().replace(/^your /, ""))
    void canUsePasskeys().then(setCanAdd)
  }, [load])

  async function add() {
    if (busy) return
    setBusy(true)
    setMessage(null)
    const result = await addPasskey()
    if (result.ok) {
      setMessage({ kind: "ok", text: `Done. Next time, tap “Sign in with ${unlock}”.` })
      await load()
    } else if (!result.cancelled) {
      setMessage({ kind: "error", text: result.error ?? "That didn't work. Please try again." })
    }
    setBusy(false)
  }

  async function remove(id: string) {
    if (removing) return
    setRemoving(id)
    setMessage(null)
    try {
      const res = await fetch(`/api/user/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok && res.status !== 404) throw new Error()
      await load()
    } catch {
      setMessage({ kind: "error", text: "Couldn't remove it. Please try again." })
    } finally {
      setRemoving(null)
    }
  }

  const list = passkeys ?? []

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
      data-testid="settings-passkeys"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0" style={{ color: "var(--muted)" }}>
          <UnlockIcon name={unlock} size={16} />
        </span>
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Sign in with {unlock}</p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            No password to type. Your face or fingerprint stays on your device — we never see it.
          </p>
        </div>
      </div>

      {passkeys === null ? (
        <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--muted)" }} />
      ) : list.length > 0 ? (
        <ul className="space-y-2" data-testid="settings-passkeys-list">
          {list.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            >
              <div className="min-w-0">
                <p className="text-sm" style={{ color: "var(--text)" }}>{p.label || "Passkey"}</p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {p.lastUsedAt ? `Last used ${day(p.lastUsedAt)}` : `Added ${day(p.createdAt)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(p.id)}
                disabled={removing !== null}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                data-testid="settings-passkey-remove"
              >
                {removing === p.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {canAdd ? (
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-60"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
          data-testid="settings-passkey-add"
        >
          {busy ? "Setting up…" : list.length > 0 ? "Set up this device too" : `Turn on ${unlock}`}
        </button>
      ) : list.length === 0 && passkeys !== null ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Open AllFantasy on your phone or computer browser to turn this on.
        </p>
      ) : null}

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className="text-xs"
          style={{ color: message.kind === "error" ? "var(--accent-red-strong)" : "var(--text)" }}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
