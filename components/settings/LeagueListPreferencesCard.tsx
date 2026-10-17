"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Eye, EyeOff, Star } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { toPlayedLeagues } from "@/lib/core-app/playedLeagues"
import { platformLabel } from "@/lib/core-app/platformLinks"
import { FAVORITES_COOKIE, parseFavoriteIds } from "@/lib/core-app/homeScope"
import { applyLeagueOrder, type LeaguePreferences } from "@/lib/core-app/leaguePreferences"

/**
 * Settings › Preferences › Your leagues — favorite, hide and order the leagues of the universal
 * My Team view (lib/core-app/leaguePreferences.ts, stored in UserProfile.corePreferences).
 *
 * The list is the same one the /core rail draws: the account's leagues through `toPlayedLeagues`,
 * the rule the rail and Home share, so a past-season import row never shows up here as a league.
 *
 * Every change saves at once (one list per POST, merged atomically on the server), like the other
 * Preferences cards that save on change. A failed save reverts the row and says so.
 */

type Row = { id: string; name: string; platform: string }

function readFavoritesCookie(playedIds: string[]): string[] {
  try {
    const raw = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${FAVORITES_COOKIE}=`))
      ?.slice(FAVORITES_COOKIE.length + 1)
    return [...parseFavoriteIds(raw ?? null, playedIds)]
  } catch {
    return []
  }
}

export default function LeagueListPreferencesCard() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [prefs, setPrefs] = useState<{ favorites: string[]; hidden: string[]; order: string[] } | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const [listRes, prefRes] = await Promise.all([
        fetch("/api/league/list?summary=1", { cache: "no-store" }),
        fetch("/api/core/league-preferences", { cache: "no-store" }),
      ])
      if (!listRes.ok || !prefRes.ok) throw new Error("load")
      const list = (await listRes.json()) as { leagues?: Array<Record<string, unknown>> }
      const saved = (await prefRes.json()) as LeaguePreferences
      const played = toPlayedLeagues(Array.isArray(list.leagues) ? list.leagues : [])
        .filter((l) => typeof l.id === "string")
        .map((l) => ({
          id: String(l.id),
          name: typeof l.name === "string" && l.name ? l.name : "League",
          platform: String(l.platform ?? ""),
        }))
      const ids = played.map((r) => r.id)
      setRows(played)
      setPrefs({
        // Before a first save the account has no list — seed from this device's stars, as /core does.
        favorites: saved.favorites ?? readFavoritesCookie(ids),
        hidden: saved.hidden ?? [],
        order: saved.order ?? [],
      })
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const ordered = useMemo(() => (rows && prefs ? applyLeagueOrder(rows, prefs.order) : []), [rows, prefs])
  const q = query.trim().toLowerCase()
  const shown = q ? ordered.filter((r) => r.name.toLowerCase().includes(q)) : ordered

  const save = async (field: "favorites" | "hidden" | "order", leagueIds: string[], revert: () => void) => {
    savingRef.current = true
    setSaving(true)
    setSaveError(false)
    try {
      const res = await fetch("/api/core/league-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, leagueIds }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      revert()
      setSaveError(true)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const toggleIn = (field: "favorites" | "hidden", id: string) => {
    if (!prefs || savingRef.current) return
    const before = prefs
    const list = prefs[field]
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    setPrefs({ ...prefs, [field]: next })
    void save(field, next, () => setPrefs(before))
  }

  /** Move by one place in the FULL order (not the search-filtered view), then save the whole order. */
  const move = (id: string, delta: -1 | 1) => {
    if (!prefs || savingRef.current) return
    const before = prefs
    const ids = ordered.map((r) => r.id)
    const i = ids.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    setPrefs({ ...prefs, order: ids })
    void save("order", ids, () => setPrefs(before))
  }

  const resetOrder = () => {
    if (!prefs || savingRef.current) return
    const before = prefs
    setPrefs({ ...prefs, order: [] })
    void save("order", [], () => setPrefs(before))
  }

  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
      aria-labelledby="league-list-prefs-title"
      aria-busy={saving}
      data-testid="settings-league-list-card"
    >
      <div>
        <h3 id="league-list-prefs-title" className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("settings.leagues.title")}
        </h3>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {t("settings.leagues.subtitle")}
        </p>
      </div>

      {loadError ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-xs" style={{ color: "var(--muted2)" }}>
            {t("settings.leagues.loadError")}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-11 rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
          >
            {t("settings.leagues.retry")}
          </button>
        </div>
      ) : !rows || !prefs ? null : rows.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {t("settings.leagues.empty")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.leagues.search")}
              aria-label={t("settings.leagues.search")}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            />
            {prefs.order.length > 0 ? (
              <button
                type="button"
                onClick={resetOrder}
                disabled={saving}
                className="min-h-11 rounded-lg border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                data-testid="league-list-reset-order"
              >
                {t("settings.leagues.resetOrder")}
              </button>
            ) : null}
          </div>
          <ul className="max-h-96 space-y-1 overflow-y-auto pr-1" data-testid="league-list-rows">
            {shown.map((r) => {
              const fav = prefs.favorites.includes(r.id)
              const hidden = prefs.hidden.includes(r.id)
              const pos = ordered.findIndex((x) => x.id === r.id)
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 py-1"
                  data-testid={`league-list-row-${r.id}`}
                  style={{ opacity: hidden ? 0.6 : 1 }}
                >
                  <button
                    type="button"
                    aria-pressed={fav}
                    aria-label={`${fav ? t("settings.leagues.unfavorite") : t("settings.leagues.favorite")}: ${r.name}`}
                    onClick={() => toggleIn("favorites", r.id)}
                    disabled={saving}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg"
                    style={{ color: fav ? "#fbbf24" : "var(--muted)" }}
                    data-testid={`league-fav-${r.id}`}
                  >
                    <Star className="h-4 w-4" fill={fav ? "currentColor" : "none"} />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" style={{ color: "var(--text)" }}>
                      {r.name}
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: "var(--muted)" }}>
                      {platformLabel(r.platform)}
                      {hidden ? ` · ${t("settings.leagues.hiddenBadge")}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-pressed={hidden}
                    aria-label={`${hidden ? t("settings.leagues.show") : t("settings.leagues.hide")}: ${r.name}`}
                    onClick={() => toggleIn("hidden", r.id)}
                    disabled={saving}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg"
                    style={{ color: "var(--muted)" }}
                    data-testid={`league-hide-${r.id}`}
                  >
                    {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  {/* Reorder only on the full list: a search-filtered view has no stable neighbours. */}
                  {!q ? (
                    <>
                      <button
                        type="button"
                        aria-label={`${t("settings.leagues.moveUp")}: ${r.name}`}
                        disabled={saving || pos <= 0}
                        onClick={() => move(r.id, -1)}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg disabled:opacity-30"
                        style={{ color: "var(--muted)" }}
                        data-testid={`league-up-${r.id}`}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${t("settings.leagues.moveDown")}: ${r.name}`}
                        disabled={saving || pos >= ordered.length - 1}
                        onClick={() => move(r.id, 1)}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-lg disabled:opacity-30"
                        style={{ color: "var(--muted)" }}
                        data-testid={`league-down-${r.id}`}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                </li>
              )
            })}
          </ul>
          {saveError ? (
            <p role="alert" className="text-xs" style={{ color: "var(--accent-red-strong, #fb7185)" }}>
              {t("settings.leagues.saveError")}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
