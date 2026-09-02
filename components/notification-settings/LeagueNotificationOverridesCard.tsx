"use client"

import { useEffect, useMemo, useState } from "react"
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
  const [leagues, setLeagues] = useState<LeagueRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await fetch("/api/league/list", { cache: "no-store" })
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
        <span className="text-sm font-medium text-[var(--text)]">Per-league settings</span>
        {customisedCount > 0 ? (
          <span className="text-xs text-[var(--muted)]" data-testid="league-overrides-count">
            {customisedCount} customised
          </span>
        ) : null}
      </div>

      <p className="text-xs text-[var(--muted)]">
        Everything above applies to all your leagues. Turn one down here without changing the
        rest — a loud dynasty league can stay quiet while your main league still reaches you.
      </p>

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
          Notifications are off for your whole account, so per-league settings have nothing to
          change yet. Turn notifications on above and these become active.
        </p>
      ) : null}

      {leagues === null ? (
        <p className="text-xs text-[var(--muted)]">Loading your leagues…</p>
      ) : loadFailed ? (
        <p className="text-xs text-[var(--muted)]" data-testid="league-overrides-load-failed">
          Could not load your leagues just now. Your global settings above are unaffected.
        </p>
      ) : leagues.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          Once you join or import a league it will show up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {leagues.map((league) => {
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
                      {league.name?.trim() || "Untitled league"}
                    </p>
                    {mutedCats.length > 0 && !muted ? (
                      <p className="text-xs text-[var(--muted)]">
                        {mutedCats.length} {mutedCats.length === 1 ? "category" : "categories"} muted
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
                    <option value="global">Follow my settings</option>
                    <option value="muted">Mute this league</option>
                  </select>
                </div>

                {!muted && !globallyOff ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : league.id)}
                      className="mt-2 text-xs text-[var(--accent-cyan)] underline-offset-2 hover:underline"
                      data-testid={`league-override-expand-${league.id}`}
                    >
                      {isExpanded ? "Hide categories" : "Mute individual categories"}
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
                            Mute {categoryLabels[id] ?? id}
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
      )}
    </div>
  )
}
