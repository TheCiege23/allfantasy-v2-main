"use client"

import { useEffect, useState } from "react"
import {
  AD_OPT_OUT_COOKIE,
  AD_OPT_OUT_COOKIE_MAX_AGE_SECONDS,
  isAdOptOutClient,
} from "@/lib/privacy/adMeasurementOptOut"

type State = {
  ready: boolean
  gpc: boolean
  optedOut: boolean
  signedIn: boolean
}

/**
 * The control on /privacy/choices. The browser cookie is written HERE as well as by the API,
 * so the choice holds for this browser even when the API cannot be reached (a VPN visitor is
 * refused every API but may load this page).
 */
export function PrivacyChoicesControl() {
  const [state, setState] = useState<State>({ ready: false, gpc: false, optedOut: false, signedIn: false })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const gpc = (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    const browserOptedOut = isAdOptOutClient()
    fetch("/api/privacy/ad-opt-out", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { signedIn?: boolean; accountOptedOut?: boolean } | null) => {
        setState({
          ready: true,
          gpc,
          signedIn: Boolean(data?.signedIn),
          optedOut: browserOptedOut || Boolean(data?.accountOptedOut),
        })
      })
      .catch(() => setState({ ready: true, gpc, signedIn: false, optedOut: browserOptedOut }))
  }, [])

  async function choose(optOut: boolean) {
    setSaving(true)
    setMessage(null)
    if (optOut) {
      document.cookie = `${AD_OPT_OUT_COOKIE}=1; Max-Age=${AD_OPT_OUT_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
    } else {
      document.cookie = `${AD_OPT_OUT_COOKIE}=; Max-Age=0; Path=/`
    }
    try {
      const res = await fetch("/api/privacy/ad-opt-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ optOut, source: "choices_page" }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; signedIn?: boolean }
      if (!res.ok) {
        setMessage(data.error ?? "Could not save your choice for your account. It is saved for this browser.")
      } else {
        setMessage(
          optOut
            ? data.signedIn
              ? "Done. You are opted out on this browser and on your account."
              : "Done. You are opted out on this browser. Sign in and choose again to apply it to your account."
            : "Done. Advertising measurement is allowed again.",
        )
      }
    } catch {
      setMessage(optOut ? "Saved for this browser. We could not reach your account; try again later." : "Could not save. Try again.")
    }
    setState((s) => ({ ...s, optedOut: optOut }))
    setSaving(false)
  }

  if (!state.ready) return <p>Checking your current choice…</p>

  return (
    <div className="af-legal-box">
      <span className="af-legal-eyebrow">Do Not Sell or Share My Personal Information</span>
      {state.gpc ? (
        <p>
          <strong>Your browser is sending Global Privacy Control.</strong> We treat that as a request to opt
          out, so advertising measurement is off for this browser
          {state.signedIn ? " and has been recorded on your account" : ""}. To change that, turn Global
          Privacy Control off in your browser.
        </p>
      ) : (
        <p>
          You are currently <strong>{state.optedOut ? "opted out" : "not opted out"}</strong>
          {state.signedIn ? "" : " on this browser"}.
        </p>
      )}
      {!state.gpc ? (
        <p style={{ marginTop: 12 }}>
          {state.optedOut ? (
            <button type="button" className="af-legal-cta af-legal-cta--ghost" disabled={saving} onClick={() => choose(false)}>
              {saving ? "Saving…" : "Allow advertising measurement"}
            </button>
          ) : (
            <button type="button" className="af-legal-cta" disabled={saving} onClick={() => choose(true)}>
              {saving ? "Saving…" : "Opt out of sharing"}
            </button>
          )}
        </p>
      ) : null}
      {message ? (
        <p role="status" style={{ marginTop: 12 }}>
          {message}
        </p>
      ) : null}
    </div>
  )
}
