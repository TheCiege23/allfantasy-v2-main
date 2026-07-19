"use client"

import { useCallback, useState } from "react"

export type AdminApiTokenRow = {
  id: string
  label: string
  ownerEmail: string
  createdByEmail: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  revokedByEmail: string | null
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString()
}

function StatusPill({ revokedAt }: { revokedAt: string | null }) {
  const revoked = Boolean(revokedAt)
  const cls = revoked
    ? "text-white/40 border-white/10 bg-white/[0.03]"
    : "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>
      {revoked ? "Revoked" : "Active"}
    </span>
  )
}

export default function AdminApiTokensClient({
  initialTokens,
}: {
  initialTokens: AdminApiTokenRow[]
}) {
  const [tokens, setTokens] = useState<AdminApiTokenRow[]>(initialTokens)
  const [label, setLabel] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  /**
   * Held in memory only, and only until the operator navigates away. The server
   * returns the raw token exactly once and stores nothing but its hash, so there is
   * no "show again" to build even if someone asks for one.
   */
  const [freshToken, setFreshToken] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/api-tokens", { cache: "no-store" })
    if (!res.ok) return
    const data = await res.json()
    setTokens(data.tokens ?? [])
  }, [])

  const createToken = useCallback(async () => {
    setError(null)
    setCreating(true)
    setFreshToken(null)
    setCopied(false)
    try {
      const res = await fetch("/api/admin/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, ownerEmail }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || "Couldn't create the token — try again.")
        return
      }
      setFreshToken(data.rawToken)
      setLabel("")
      setOwnerEmail("")
      await refresh()
    } catch {
      setError("Couldn't create the token — try again.")
    } finally {
      setCreating(false)
    }
  }, [label, ownerEmail, refresh])

  const revokeToken = useCallback(
    async (id: string, tokenLabel: string) => {
      if (!window.confirm(`Revoke "${tokenLabel}"? Any caller using it stops working immediately.`)) {
        return
      }
      setError(null)
      setRevokingId(id)
      try {
        const res = await fetch(`/api/admin/api-tokens/${id}`, { method: "DELETE" })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          setError(data?.error || "Couldn't revoke the token — try again.")
          return
        }
        await refresh()
      } catch {
        setError("Couldn't revoke the token — try again.")
      } finally {
        setRevokingId(null)
      }
    },
    [refresh],
  )

  const copyToken = useCallback(async () => {
    if (!freshToken) return
    try {
      await navigator.clipboard.writeText(freshToken)
      setCopied(true)
    } catch {
      setError("Couldn't copy automatically — select the token and copy it manually.")
    }
  }, [freshToken])

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-bold text-white">Create a token</h2>
        <p className="mt-1 text-xs text-white/50">
          The token acts as the owner and can never do more than they can. If the owner loses admin
          access, the token stops working.
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. deploy bot)"
            className="flex-1 rounded-lg border border-white/10 bg-[#0b1220] px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <input
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="Owner email (must already be an admin)"
            className="flex-1 rounded-lg border border-white/10 bg-[#0b1220] px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={createToken}
            disabled={creating || !label.trim() || !ownerEmail.trim()}
            className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-bold text-[#020817] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create token"}
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-xs font-semibold text-rose-300">
            {error}
          </p>
        ) : null}

        {freshToken ? (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <p className="text-xs font-bold text-amber-200">
              Copy this now — it will not be shown again.
            </p>
            <code className="mt-2 block break-all rounded bg-[#020817] px-3 py-2 font-mono text-xs text-white">
              {freshToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-bold text-white">Tokens</h2>
        {tokens.length === 0 ? (
          <p className="mt-3 text-xs text-white/50">No tokens yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-white/40">
                <tr>
                  <th className="pb-2 font-semibold">Label</th>
                  <th className="pb-2 font-semibold">Owner</th>
                  <th className="pb-2 font-semibold">Created</th>
                  <th className="pb-2 font-semibold">Last used</th>
                  <th className="pb-2 font-semibold">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="text-white/80">
                {tokens.map((t) => (
                  <tr key={t.id} className="border-t border-white/5">
                    <td className="py-2.5 font-semibold text-white">{t.label}</td>
                    <td className="py-2.5">{t.ownerEmail}</td>
                    <td className="py-2.5 text-white/50">{formatWhen(t.createdAt)}</td>
                    <td className="py-2.5 text-white/50">{formatWhen(t.lastUsedAt)}</td>
                    <td className="py-2.5">
                      <StatusPill revokedAt={t.revokedAt} />
                    </td>
                    <td className="py-2.5 text-right">
                      {t.revokedAt ? null : (
                        <button
                          type="button"
                          onClick={() => revokeToken(t.id, t.label)}
                          disabled={revokingId === t.id}
                          className="rounded-lg border border-rose-500/30 px-3 py-1 text-[11px] font-bold text-rose-300 disabled:opacity-40"
                        >
                          {revokingId === t.id ? "Revoking…" : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
