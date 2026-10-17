"use client"

import { useEffect, useState } from "react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

/**
 * Save a MyFantasyLeague API key, so MFL leagues can be imported.
 *
 * ⚠ THIS IS THE ONLY THING MFL HAS EVER BEEN MISSING. The adapter
 * (`MflAdapter`, 292 lines), the fetch service (`MflLeagueFetchService`), the
 * normalization pipeline entry and the storage column (`LeagueAuth.apiKey`,
 * which `/api/league/auth` already encrypts) have all existed. What did not
 * exist was anywhere in the product to type a key — so `getMflAuthForUser`
 * threw on every import, and the tile stayed marked "soon" while the machinery
 * behind it sat finished.
 *
 * ⚠ AN API KEY IS NOT A PASSWORD, AND THE COPY HAS TO SAY WHICH. MFL issues a
 * key that reads league data; it is not account credentials, and this product
 * never asks for those. Getting that distinction wrong is how a setup step
 * starts feeling like a security risk.
 *
 * Modelled on `EspnCookieConnection` — same endpoint, same status shape, same
 * place in Settings — minus the browser-extension path, which is an ESPN-only
 * mechanism for lifting cookies out of a logged-in session. A key is typed.
 */

type MflAuthStatus = {
  connected: boolean
  updatedAt: string | null
}

async function fetchMflAuthStatus(): Promise<MflAuthStatus> {
  const res = await fetch("/api/league/auth", { cache: "no-store" })
  if (!res.ok) return { connected: false, updatedAt: null }
  const data = await res.json().catch(() => null)
  const auths = Array.isArray(data?.auths) ? data.auths : []
  const mfl = auths.find((a: { platform?: string }) => a.platform === "mfl")
  /*
   * `hasApiKey` rather than the key itself — the endpoint deliberately never
   * returns a stored credential, so "connected" is the only thing a client can
   * know, and that is all this needs.
   */
  return { connected: Boolean(mfl?.hasApiKey), updatedAt: mfl?.updatedAt ?? null }
}

export function MflApiKeyConnection() {
  const { t, tInterpolate } = useLanguage()
  const [status, setStatus] = useState<MflAuthStatus | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchMflAuthStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setMessage({ tone: "error", text: t("settings.mfl.pasteFirst") })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/league/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "mfl", apiKey: trimmed }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        /* The endpoint's own words — it knows why better than this screen does. */
        setMessage({ tone: "error", text: data?.error || t("settings.mfl.saveFailed") })
        return
      }
      /*
       * Cleared on success so the key is not left sitting in a form field, and
       * re-read rather than assumed: a save that did not land must not render
       * as connected.
       */
      setApiKey("")
      setStatus(await fetchMflAuthStatus())
      setMessage({ tone: "ok", text: t("settings.mfl.saved") })
    } catch {
      setMessage({ tone: "error", text: t("settings.mfl.saveUnreachable") })
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/league/auth", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "mfl" }),
      })
      if (!res.ok) {
        setMessage({ tone: "error", text: t("settings.mfl.removeFailed") })
        return
      }
      setStatus(await fetchMflAuthStatus())
      setMessage({
        tone: "ok",
        /* Says what it did NOT do: leagues already imported are unaffected. */
        text: t("settings.mfl.removed"),
      })
    } catch {
      setMessage({ tone: "error", text: t("settings.mfl.removeUnreachable") })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="mt-2 rounded-lg border p-3 text-xs"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      <p style={{ color: "var(--text)", fontWeight: 600 }}>{t("settings.mfl.title")}</p>

      <p className="mt-1">
        {t("settings.mfl.bodyBefore")}{" "}
        <strong style={{ color: "var(--text)" }}>{t("settings.mfl.bodyStrong")}</strong>
        {t("settings.mfl.bodyAfter")}
      </p>

      {status === null ? (
        <p className="mt-2">{t("settings.mfl.checking")}</p>
      ) : status.connected ? (
        <>
          <p className="mt-2" style={{ color: "var(--text)" }}>
            {t("settings.connected.connectedLabel")}
            {status.updatedAt
              ? tInterpolate("settings.mfl.savedOn", { date: new Date(status.updatedAt).toLocaleDateString() })
              : ""}
          </p>
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="mt-2 rounded-lg border px-3 py-2 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {busy ? t("settings.mfl.removing") : t("settings.mfl.removeKey")}
          </button>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t("settings.mfl.placeholder")}
            /*
             * A password field, because it is a credential and shoulder-surfing
             * is real — even though it is not an account password.
             */
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "transparent" }}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-lg border px-3 py-2 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {busy ? t("settings.actions.saving") : t("settings.mfl.saveKey")}
          </button>
        </div>
      )}

      {message ? (
        <p className="mt-2" style={{ color: message.tone === "error" ? "var(--bad, #fb5b78)" : "var(--text)" }}>
          {message.text}
        </p>
      ) : null}
    </div>
  )
}
