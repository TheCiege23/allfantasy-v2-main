"use client"

import { useEffect, useMemo, useState } from "react"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import type {
  NotificationCategoryId,
  NotificationPreferences,
} from "@/lib/notification-settings/types"
import {
  followGlobal,
  muteLeague,
  toggleCategory,
} from "@/lib/notification-settings/leagueOverrideEdits"

/**
 * Per-league notification overrides (spec item 15: "global for now by default. can we do
 * global but also allow users to pick by specific league?").
 *
 * 🛑 THIS LIVES IN PERSONAL SETTINGS, NOT LEAGUE SETTINGS, AND THAT IS A DELIBERATE
 * DEPARTURE FROM THE ASK. The request said "like in the league settings?" — but the
 * league Settings tab is not a surface every member has. In `LeagueShell.tsx` the
 * general/imported path appends Settings unconditionally, while the NFL redraft core path
 * pushes it only `if (isCommissioner)` and then filters it out of the tab row entirely
 * because it is modal-driven. So in a 12-team redraft league, eleven people would have had
 * a personal preference they could not reach.
 *
 * That is the same defect this project already fixed once: the push pipeline was complete
 * and the opt-in was unreachable. A preference nobody can open is indistinguishable from
 * one that does not exist. It belongs beside the global switch it modifies.
 *
 * 🛑 "FOLLOW MY SETTINGS" STORES `{}` AND MUST NOT DELETE THE KEY. The save merges one
 * level deep in `mergeNotificationPreferences`, so the server computes
 * `{ ...stored, ...incoming }` and restores anything this client removed. A delete looks
 * completely right on screen — the row flips, the request succeeds — and the mute is back
 * on the next load, with no error and no failed request. There is a failing control for
 * this in __tests__/league-notification-overrides.test.ts; it is not a style preference.
 *
 * ⚠ `enabled: true` would ALSO be wrong, but be accurate about why: it is not currently
 * distinguishable in behaviour. `isCategoryAllowedForLeague` only ever tests
 * `enabled === false`, and `customisedLeagueIds` only counts `false`, so today it behaves
 * exactly like `{}`. The objection is that it records a decision the user did not make —
 * which is what `lib/notifications/leagueOverrides.ts` means by absence inheriting.
 *
 * The edits themselves live in lib/notification-settings/leagueOverrideEdits.ts.
 */

/**
 * Rows shown before "Show all". An account here can be in dozens of leagues (measured 2026-10-15:
 * one account was in 101 league rows) and every row is a full-height card, so listing them all
 * turned this section into a long scroll to reach the settings below it. Leagues with an override
 * are always shown, whatever this says, so a mute can never be hidden.
 */
export const LEAGUE_OVERRIDES_VISIBLE_DEFAULT = 5

type LeagueRow = {
  id: string
  name?: string
  platform?: string | null
  season?: string | number | null
}

export function LeagueNotificationOverridesCard({
  prefs,
  onChange,
  categoryIds,
  categoryLabels,
}: {
  prefs: NotificationPreferences
  onChange: (next: NotificationPreferences) => void
  /**
   * Passed in rather than recomputed here. The section already filters hidden categories
   * (a toggle must govern an event something actually fires); deriving that rule a second
   * time is how two implementations of one rule drift apart.
   */
  categoryIds: NotificationCategoryId[]
  categoryLabels: Record<NotificationCategoryId, string>
}) {
  const { t, tInterpolate } = useOptionalLanguage()
  const [leagues, setLeagues] = useState<LeagueRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      /*
       * `summary=1` drops each league's settings and rosters (~94% of the payload — this card reads
       * only id and name), and `collapseSeries=1` returns one row per league at its newest season
       * instead of one per imported season. Notifications are sent for the current season's league,
       * so that is the row an override has to be keyed on.
       */
      const data = await fetch("/api/league/list?summary=1&collapseSeries=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      if (cancelled) return
      if (data && Array.isArray(data.leagues)) setLeagues(data.leagues as LeagueRow[])
      else {
        // Distinguish "you have no leagues" from "we could not ask". Rendering an empty
        // list on a failed fetch tells the user they have nothing to configure, which is
        // a different and wrong statement.
        setLeagues([])
        setLoadFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const globallyOff = prefs.globalEnabled === false

  const customisedCount = useMemo(() => {
    const entries = Object.values(prefs.leagues ?? {})
    return entries.filter(
      (v) => v && (v.enabled === false || (v.mutedCategories?.length ?? 0) > 0),
    ).length
  }, [prefs.leagues])

  /*
   * The three edits are pure functions in lib/notification-settings/leagueOverrideEdits.ts,
   * so the round-trip test can drive the real edit through the real server merge rather
   * than rebuilding these objects by hand. Read that module before changing any of them —
   * in particular why "no opinion" is `{}` and never a deleted key.
   */
  /** Customised leagues first (so a mute is never below the fold), then the list's own order. */
  const ordered = useMemo(() => {
    if (!leagues) return []
    const seen = new Set<string>()
    const unique = leagues.filter((l) => l?.id && !seen.has(l.id) && seen.add(l.id))
    const isCustomised = (id: string) => {
      const v = prefs.leagues?.[id]
      return Boolean(v && (v.enabled === false || (v.mutedCategories?.length ?? 0) > 0))
    }
    return [...unique.filter((l) => isCustomised(l.id)), ...unique.filter((l) => !isCustomised(l.id))]
  }, [leagues, prefs.leagues])

  const needle = query.trim().toLowerCase()
  const collapsible = ordered.length > LEAGUE_OVERRIDES_VISIBLE_DEFAULT
  const visible = needle
    ? ordered.filter((l) => (l.name ?? "").toLowerCase().includes(needle))
    : showAll || !collapsible
      ? ordered
      : ordered.slice(0, Math.max(LEAGUE_OVERRIDES_VISIBLE_DEFAULT, customisedCount))

  function onFollowGlobal(leagueId: string) {
    onChange(followGlobal(prefs, leagueId))
  }

  function onMuteLeague(leagueId: string) {
    onChange(muteLeague(prefs, leagueId))
  }

  function onToggleCategory(leagueId: string, category: NotificationCategoryId, muted: boolean) {
    onChange(toggleCategory(prefs, leagueId, category, muted))
  }

  return (
    <div
      className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--panel2)] p-4"
      data-testid="notifications-league-overrides-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-[var(--text)]">{t("settings.notifications.leagues.title")}</span>
        {customisedCount > 0 ? (
          <span className="text-xs text-[var(--muted)]" data-testid="league-overrides-count">
            {tInterpolate("settings.notifications.leagues.customised", { count: customisedCount })}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-[var(--muted)]">{t("settings.notifications.leagues.intro")}</p>

      {globallyOff ? (
        /*
         * ⚠ THE MASTER SWITCH IS NOT OVERRIDABLE UPWARD, so with notifications globally off
         * every control below is inert. Rendering them live would be a control that looks
         * like it works and silently does nothing — say so instead of pretending.
         */
        <p
          className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-xs text-[var(--muted)]"
          data-testid="league-overrides-globally-off"
        >
          {t("settings.notifications.leagues.globallyOff")}
        </p>
      ) : null}

      {leagues === null ? (
        <p className="text-xs text-[var(--muted)]">{t("settings.notifications.leagues.loading")}</p>
      ) : loadFailed ? (
        <p className="text-xs text-[var(--muted)]" data-testid="league-overrides-load-failed">
          {t("settings.notifications.leagues.loadFailed")}
        </p>
      ) : leagues.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">{t("settings.notifications.leagues.empty")}</p>
      ) : (
        <>
        {collapsible ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.notifications.leagues.search")}
            aria-label={t("settings.notifications.leagues.search")}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
            data-testid="league-overrides-search"
          />
        ) : null}
        {needle && visible.length === 0 ? (
          <p className="text-xs text-[var(--muted)]" data-testid="league-overrides-no-match">
            {tInterpolate("settings.notifications.leagues.noMatch", { query: query.trim() })}
          </p>
        ) : null}
        <ul className="space-y-2">
          {visible.map((league) => {
            const override = prefs.leagues?.[league.id]
            const muted = override?.enabled === false
            const mutedCats = override?.mutedCategories ?? []
            const isExpanded = expanded === league.id

            return (
              <li
                key={league.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3"
                data-testid={`league-override-row-${league.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--text)]">
                      {league.name?.trim() || t("settings.notifications.leagues.untitled")}
                    </p>
                    {mutedCats.length > 0 && !muted ? (
                      <p className="text-xs text-[var(--muted)]">
                        {tInterpolate(
                          mutedCats.length === 1
                            ? "settings.notifications.leagues.mutedOne"
                            : "settings.notifications.leagues.mutedMany",
                          { count: mutedCats.length },
                        )}
                      </p>
                    ) : null}
                  </div>

                  <select
                    value={muted ? "muted" : "global"}
                    disabled={globallyOff}
                    onChange={(e) => {
                      if (e.target.value === "muted") onMuteLeague(league.id)
                      else onFollowGlobal(league.id)
                    }}
                    className="rounded-md border border-[var(--border)] bg-[var(--panel2)] px-2 py-1 text-xs text-[var(--text)] disabled:opacity-50"
                    data-testid={`league-override-select-${league.id}`}
                  >
                    <option value="global">{t("settings.notifications.leagues.follow")}</option>
                    <option value="muted">{t("settings.notifications.leagues.mute")}</option>
                  </select>
                </div>

                {!muted && !globallyOff ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : league.id)}
                      className="mt-1 inline-flex min-h-[44px] items-center text-xs text-[var(--accent-cyan)] underline-offset-2 hover:underline"
                      data-testid={`league-override-expand-${league.id}`}
                    >
                      {isExpanded
                        ? t("settings.notifications.leagues.hideCategories")
                        : t("settings.notifications.leagues.muteIndividual")}
                    </button>

                    {isExpanded ? (
                      <div className="mt-2 grid gap-1 sm:grid-cols-2">
                        {categoryIds.map((id) => (
                          <label
                            key={id}
                            className="flex items-center gap-2 text-xs text-[var(--muted)]"
                          >
                            <input
                              type="checkbox"
                              checked={mutedCats.includes(id)}
                              onChange={(e) => onToggleCategory(league.id, id, e.target.checked)}
                              className="h-3.5 w-3.5 rounded accent-[var(--accent-cyan)]"
                              data-testid={`league-override-cat-${league.id}-${id}`}
                            />
                            {tInterpolate("settings.notifications.leagues.muteCategory", {
                              label: categoryLabels[id] ?? id,
                            })}
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
        {collapsible && !needle ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="inline-flex min-h-[44px] items-center text-sm font-medium text-[var(--accent-cyan)]"
            data-testid="league-overrides-show-all"
          >
            {showAll
              ? t("settings.notifications.leagues.showFewer")
              : tInterpolate("settings.notifications.leagues.showAll", { count: ordered.length })}
          </button>
        ) : null}
        </>
      )}
    </div>
  )
}
