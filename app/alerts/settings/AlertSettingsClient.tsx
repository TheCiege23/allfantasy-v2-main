"use client"

import React from "react"
import { useState, useEffect } from "react"
import ChimmyAlertPreferencesPanel from "@/components/chimmy-surfaces/ChimmyAlertPreferencesPanel"

export default function AlertSettingsClient() {
  const [injuryAlerts, setInjuryAlerts] = useState(true)
  const [performanceAlerts, setPerformanceAlerts] = useState(true)
  const [lineupAlerts, setLineupAlerts] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetch("/api/alerts/preferences")
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return
        if (data.injuryAlerts !== undefined) setInjuryAlerts(data.injuryAlerts)
        if (data.performanceAlerts !== undefined) setPerformanceAlerts(data.performanceAlerts)
        if (data.lineupAlerts !== undefined) setLineupAlerts(data.lineupAlerts)
      })
      .catch(() => { if (mounted) setError("Failed to load preferences") })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch("/api/alerts/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          injuryAlerts,
          performanceAlerts,
          lineupAlerts,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Failed to save")
        return
      }
      setSaved(true)
    } catch {
      setError("Failed to save")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-6 py-8 text-center text-white/50">
        Loading...
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* 44px rows with a hairline between (2026-11-25, the simplify pass); the whole row is the label. */}
      <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5 px-4">
        <label className="flex min-h-[48px] items-center justify-between gap-3 cursor-pointer" data-testid="sports-alert-toggle-injury">
          <span className="text-sm font-medium text-white">Player injury alerts</span>
          <input
            type="checkbox"
            checked={injuryAlerts}
            onChange={(e) => setInjuryAlerts(e.target.checked)}
            className="h-5 w-5 rounded border-white/20 bg-black/30 text-cyan-500 focus:ring-cyan-500"
          />
        </label>
        <label className="flex min-h-[48px] items-center justify-between gap-3 cursor-pointer" data-testid="sports-alert-toggle-performance">
          <span className="text-sm font-medium text-white">Game performance alerts</span>
          <input
            type="checkbox"
            checked={performanceAlerts}
            onChange={(e) => setPerformanceAlerts(e.target.checked)}
            className="h-5 w-5 rounded border-white/20 bg-black/30 text-cyan-500 focus:ring-cyan-500"
          />
        </label>
        <label className="flex min-h-[48px] items-center justify-between gap-3 cursor-pointer" data-testid="sports-alert-toggle-lineup">
          <span className="text-sm font-medium text-white">Starting lineup alerts</span>
          <input
            type="checkbox"
            checked={lineupAlerts}
            onChange={(e) => setLineupAlerts(e.target.checked)}
            className="h-5 w-5 rounded border-white/20 bg-black/30 text-cyan-500 focus:ring-cyan-500"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        data-testid="sports-alert-save-button"
        className="w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save preferences"}
      </button>

      {saved && (
        <p className="text-xs text-emerald-300" data-testid="sports-alert-save-success">
          Preferences saved.
        </p>
      )}

      {/*
        One closed row (2026-11-25, the simplify pass), as in Settings › Notifications: open, the panel was
        ~650px under a second title ("Chimmy Alert Settings") and a line describing it. The fine print
        about the bell joined the intro at the top of the page.
      */}
      <details className="group mt-6 rounded-2xl border border-white/10 bg-white/5" data-testid="alerts-chimmy-fold">
        <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold text-white">Chimmy alert controls</span>
          <span className="flex items-center gap-2 text-xs text-white/50">
            Volume, channels, muted
            <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
          </span>
        </summary>
        <div className="px-4 pb-4">
          <ChimmyAlertPreferencesPanel />
        </div>
      </details>
    </div>
  )
}
