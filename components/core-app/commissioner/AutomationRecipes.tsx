'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildRecipeSettingsMerge, type RecipeKey } from '@/lib/core-app/commissioner/recipes'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import { buildChimmySpeaksUpMerge } from '@/lib/league-chat/chimmyIdentity'

/**
 * Automation recipe switches (brief item 8).
 *
 * ⚠ NO NEW ENDPOINT. Saved through `PATCH /api/league/settings`, which is
 * commissioner-gated and writes an audit row — the switch this component flips
 * shows up in the hub's own audit log. The route re-checks the role, so this
 * component cannot grant what the server did not.
 *
 * ⚠ THE WHOLE `commissionerRecipes` OBJECT IS SENT EVERY TIME. `settingsMerge`
 * merges one level deep; sending one key would reset the others.
 */
export function AutomationRecipes({
  leagueId,
  recipes,
}: {
  leagueId: string
  recipes: CommissionerHubData['recipes']
}) {
  const router = useRouter()
  const [values, setValues] = useState(recipes.values)
  /* Missing on an older payload means the default: on. */
  const [chimmyOn, setChimmyOn] = useState(recipes.chimmySpeaksUp !== false)
  const [busy, setBusy] = useState<RecipeKey | 'chimmy' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save(settingsMerge: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch('/api/league/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ leagueId, settingsMerge }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `Could not save (${res.status}).`)
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('Could not reach AllFantasy. Nothing was changed.')
      return false
    }
  }

  async function toggle(key: RecipeKey, enabled: boolean) {
    setBusy(key)
    setError(null)
    const previous = values
    setValues({ ...values, [key]: enabled })
    if (!(await save(buildRecipeSettingsMerge(previous, { key, enabled }, new Date())))) setValues(previous)
    setBusy(null)
  }

  /*
   * One top-level boolean (`chimmySpeaksUp`), so the shallow `settingsMerge` cannot clobber anything
   * else. Same route, same commissioner gate, same audit row as the recipes.
   */
  async function toggleChimmy(enabled: boolean) {
    setBusy('chimmy')
    setError(null)
    setChimmyOn(enabled)
    if (!(await save(buildChimmySpeaksUpMerge(enabled)))) setChimmyOn(!enabled)
    setBusy(null)
  }

  return (
    <div className="af-ch-recipes">
      {!recipes.sendEnabled ? (
        <p className="af-ch-recipes-banner">
          Your choices are saved now. Reminders, check-ins and announcements start posting once AllFantasy
          switches automated sending on — nothing is sent to your league before then. The weekly recap already runs.
        </p>
      ) : null}
      <ul className="af-ch-recipe-list">
        <li data-on={chimmyOn} data-testid="chimmy-speaks-up">
          <div className="af-ch-recipe-body">
            <p className="af-ch-recipe-label">Chimmy speaks up in league chat</p>
            <p className="af-ch-recipe-desc">
              Chimmy posts the weekly awards and a take on every trade — who won it on paper, with the numbers. Up to
              four moments a day, plus the weekly awards. Off keeps Chimmy quiet in this league&apos;s chat, the weekly
              recap included.
            </p>
            <p className="af-ch-recipe-meta">Posts as Chimmy, with Chimmy&apos;s badge · on by default</p>
          </div>
          <label className="af-ch-switch">
            <input
              type="checkbox"
              role="switch"
              checked={chimmyOn}
              disabled={busy != null}
              aria-label={`Chimmy speaks up in league chat: ${chimmyOn ? 'on' : 'off'}`}
              onChange={(e) => toggleChimmy(e.target.checked)}
            />
            <span aria-hidden className="af-ch-switch-track">
              <span className="af-ch-switch-thumb" />
            </span>
          </label>
        </li>
        {recipes.catalog.map((r) => {
          const on = values[r.key]
          const disabled = r.unavailable != null || busy != null
          return (
            <li key={r.key} data-on={on && !r.unavailable}>
              <div className="af-ch-recipe-body">
                <p className="af-ch-recipe-label">{r.label}</p>
                <p className="af-ch-recipe-desc">{r.description}</p>
                <p className="af-ch-recipe-meta">
                  {r.unavailable
                    ? r.unavailable
                    : r.key === 'weeklyRecap'
                      ? `${r.cadence} · posted by Chimmy${chimmyOn ? '' : ' — off while Chimmy is quiet'}`
                      : `${r.cadence} · posts in league chat`}
                </p>
              </div>
              <label className="af-ch-switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={on && !r.unavailable}
                  disabled={disabled}
                  aria-label={`${r.label}: ${on ? 'on' : 'off'}`}
                  onChange={(e) => toggle(r.key, e.target.checked)}
                />
                <span aria-hidden className="af-ch-switch-track">
                  <span className="af-ch-switch-thumb" />
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {error ? (
        <p className="af-ch-recipe-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="af-ch-muted">
        Every message goes to this league’s chat, where each member gets it by their own notification settings.
        {recipes.updatedAt ? ` Last changed ${new Date(recipes.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}.` : ''}
      </p>
    </div>
  )
}
