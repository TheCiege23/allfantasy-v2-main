"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { useEntitlement } from "@/hooks/useEntitlement"
import type { AutoCoachUserPreferences } from "@/lib/autocoach/autoCoachPreferences"

/**
 * Settings › Preferences › AutoCoach — the controls the engine actually honours, and nothing else.
 *
 * 🛑 FOUR THINGS, ON PURPOSE. The stored preferences also carry aggressiveness, a confidence
 * threshold, a minimum points edge, questionable handling and an email toggle. None is shown:
 * AutoCoach only replaces a starter who is definitively OUT (a guaranteed zero), so a margin knob
 * could only BLOCK a strict improvement while calling itself "conservative"; questionable players
 * are never touched anyway; and nothing sends an AutoCoach email. Showing a control the engine
 * ignores is the exact thing Settings removed with the old Chimmy tab. See `autoCoachSkipReason`.
 *
 * What is here, and where each is enforced:
 *  - the global switch — `UserProfile.autoCoachGlobalEnabled`, checked per user in the engine;
 *  - positions off — `positionOverrides[POS].disabled`, `autoCoachSkipReason` → 'position_off';
 *  - players I manage myself — `excludedPlayerIds`, never moved out OR in ('excluded');
 *  - a read-only note that every swap sends an in-app alert (it always does; there is no off).
 * Per-league on/off stays on each league's Team tab, which is where it already lives.
 */

type LeagueRow = {
  leagueId: string
  enabled: boolean
  blockedByCommissioner: boolean
  totalSwapsMade: number
  league: { id: string; name: string | null; autoCoachEnabled: boolean | null }
}

type RosterPlayer = { id: string; name: string; position: string | null; team: string | null; leagueNames: string[] }

type Loaded = {
  globalEnabled: boolean
  preferences: AutoCoachUserPreferences
  settings: LeagueRow[]
  players: RosterPlayer[]
}

const BASE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const

export default function AutoCoachSettingsCard() {
  const { t, tInterpolate } = useLanguage()
  const ent = useEntitlement("pro_autocoach")
  const hasAccess = ent.hasAccess("pro_autocoach")

  const [data, setData] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await fetch("/api/user/autocoach?include=players", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const j = (await res.json()) as Partial<Loaded>
      setData({
        globalEnabled: j.globalEnabled !== false,
        preferences: (j.preferences ?? {}) as AutoCoachUserPreferences,
        settings: Array.isArray(j.settings) ? j.settings : [],
        players: Array.isArray(j.players) ? j.players : [],
      })
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    if (hasAccess) void load()
  }, [hasAccess, load])

  /** Merge-save one or more preference keys. The route merges top-level keys over what is stored. */
  const savePreferences = async (key: string, patch: Partial<AutoCoachUserPreferences>) => {
    if (!data) return
    const before = data
    setBusy(key)
    setSaveError(false)
    setData({ ...data, preferences: { ...data.preferences, ...patch } })
    try {
      const res = await fetch("/api/user/autocoach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: patch }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setData(before)
      setSaveError(true)
    } finally {
      setBusy(null)
    }
  }

  const setGlobal = async (enabled: boolean) => {
    if (!data) return
    const before = data
    setBusy("global")
    setSaveError(false)
    setData({ ...data, globalEnabled: enabled })
    try {
      const res = await fetch("/api/user/autocoach/global", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setData(before)
      setSaveError(true)
    } finally {
      setBusy(null)
    }
  }

  const prefs = data?.preferences
  const excluded = useMemo(() => new Set(prefs?.excludedPlayerIds ?? []), [prefs?.excludedPlayerIds])

  const positions = useMemo(() => {
    const seen = new Set<string>(BASE_POSITIONS)
    for (const p of data?.players ?? []) if (p.position) seen.add(p.position.toUpperCase())
    for (const pos of Object.keys(prefs?.positionOverrides ?? {})) seen.add(pos.toUpperCase())
    return [...seen]
  }, [data?.players, prefs?.positionOverrides])

  const togglePosition = (pos: string) => {
    if (!prefs) return
    const current = prefs.positionOverrides ?? {}
    const off = current[pos]?.disabled === true
    void savePreferences(`pos:${pos}`, {
      positionOverrides: { ...current, [pos]: { ...(current[pos] ?? {}), disabled: !off } },
    })
  }

  const toggleExcluded = (id: string) => {
    if (!prefs) return
    const list = prefs.excludedPlayerIds ?? []
    void savePreferences(`player:${id}`, {
      excludedPlayerIds: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    })
  }

  const playerRows = useMemo(() => {
    const players = data?.players ?? []
    const known = new Set(players.map((p) => p.id))
    // An exclusion for someone no longer rostered still protects them; keep it visible and removable.
    const orphans: RosterPlayer[] = [...excluded]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: id, position: null, team: null, leagueNames: [] }))
    const q = query.trim().toLowerCase()
    const all = [...orphans, ...players].filter((p) => !q || `${p.name} ${p.position ?? ""} ${p.team ?? ""}`.toLowerCase().includes(q))
    // Managed players first, so what you have switched off is never buried.
    return all.sort((a, b) => Number(excluded.has(b.id)) - Number(excluded.has(a.id)))
  }, [data?.players, excluded, query])

  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
      aria-labelledby="autocoach-settings-title"
      data-testid="settings-autocoach-card"
    >
      <div>
        <h3 id="autocoach-settings-title" className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("settings.autocoach.title")}
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {t("settings.autocoach.subtitle")}
        </p>
      </div>

      {ent.loading ? null : !hasAccess ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs" style={{ color: "var(--muted2)" }}>
            {t("settings.autocoach.locked")}
          </p>
          <Link href={ent.upgradePath || "/pricing"} className="ns-btn-primary" data-testid="settings-autocoach-upgrade">
            {t("settings.autocoach.upgrade")}
          </Link>
        </div>
      ) : loadError ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-xs" style={{ color: "var(--muted2)" }}>
            {t("settings.autocoach.loadError")}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {t("settings.autocoach.retry")}
          </button>
        </div>
      ) : !data || !prefs ? null : (
        <>
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm" style={{ color: "var(--text)" }}>
                {t("settings.autocoach.globalLabel")}
              </span>
              <span className="mt-0.5 block text-xs" style={{ color: "var(--muted)" }}>
                {t("settings.autocoach.globalHint")}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={data.globalEnabled}
              disabled={busy === "global"}
              onChange={(e) => void setGlobal(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 rounded accent-[var(--accent-cyan)]"
              data-testid="settings-autocoach-global"
            />
          </label>

          <div>
            <p className="mb-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>
              {t("settings.autocoach.leagues")}
            </p>
            {data.settings.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {t("settings.autocoach.leaguesEmpty")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.settings.map((s) => {
                  const blocked = s.blockedByCommissioner || s.league.autoCoachEnabled === false
                  const on = s.enabled && !blocked && data.globalEnabled
                  return (
                    <li key={s.leagueId} className="flex items-center justify-between gap-3 text-sm">
                      <Link
                        href={`/league/${encodeURIComponent(s.leagueId)}?tab=team`}
                        className="min-w-0 truncate underline-offset-2 hover:underline"
                        style={{ color: "var(--text)" }}
                      >
                        {s.league.name ?? "League"}
                      </Link>
                      <span className="shrink-0 text-xs" style={{ color: on ? "var(--accent-cyan)" : "var(--muted)" }}>
                        {blocked
                          ? t("settings.autocoach.leagueBlocked")
                          : on
                            ? t("settings.autocoach.leagueOn")
                            : t("settings.autocoach.leagueOff")}
                        {s.totalSwapsMade > 0
                          ? ` · ${tInterpolate("settings.autocoach.swapsMade", { count: String(s.totalSwapsMade) })}`
                          : ""}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <fieldset>
            <legend className="mb-1 text-xs font-medium" style={{ color: "var(--muted2)" }}>
              {t("settings.autocoach.positions")}
            </legend>
            <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
              {t("settings.autocoach.positionsHint")}
            </p>
            <div className="flex flex-wrap gap-2">
              {positions.map((pos) => {
                const allowed = prefs.positionOverrides?.[pos]?.disabled !== true
                return (
                  <button
                    key={pos}
                    type="button"
                    role="switch"
                    aria-checked={allowed}
                    disabled={busy === `pos:${pos}`}
                    onClick={() => togglePosition(pos)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                    style={{
                      borderColor: allowed ? "var(--accent-cyan)" : "var(--border)",
                      color: allowed ? "var(--text)" : "var(--muted)",
                      textDecoration: allowed ? undefined : "line-through",
                    }}
                    data-testid={`settings-autocoach-pos-${pos}`}
                  >
                    {pos}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div>
            <p className="mb-1 text-xs font-medium" style={{ color: "var(--muted2)" }}>
              {t("settings.autocoach.players")}
            </p>
            <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
              {t("settings.autocoach.playersHint")}
            </p>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.autocoach.playersSearch")}
              aria-label={t("settings.autocoach.playersSearch")}
              className="mb-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            />
            {playerRows.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {t("settings.autocoach.playersEmpty")}
              </p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto pr-1" data-testid="settings-autocoach-players">
                {playerRows.map((p) => {
                  const managed = excluded.has(p.id)
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-1">
                      <span className="min-w-0">
                        <span className="block truncate text-sm" style={{ color: "var(--text)" }}>
                          {p.name}
                          {p.position ? (
                            <span className="ml-1.5 text-xs" style={{ color: "var(--muted)" }}>
                              {p.position}
                              {p.team ? ` · ${p.team}` : ""}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11px]" style={{ color: "var(--muted)" }}>
                          {p.leagueNames.length > 0 ? p.leagueNames.join(", ") : t("settings.autocoach.notRostered")}
                        </span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={managed}
                        aria-label={`${t("settings.autocoach.manage")}: ${p.name}`}
                        disabled={busy === `player:${p.id}`}
                        onClick={() => toggleExcluded(p.id)}
                        className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium"
                        style={{
                          borderColor: managed ? "var(--accent-cyan)" : "var(--border)",
                          color: managed ? "var(--accent-cyan)" : "var(--text)",
                        }}
                      >
                        {managed ? t("settings.autocoach.managing") : t("settings.autocoach.manage")}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {t("settings.autocoach.alertNote")}
          </p>

          {saveError ? (
            <p role="alert" className="text-xs" style={{ color: "var(--accent-red-strong, #fb7185)" }}>
              {t("settings.autocoach.saveError")}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
