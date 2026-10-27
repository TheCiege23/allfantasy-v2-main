'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppModal } from '@/components/ui/AppModal'
import { buildLeagueRulebook, welcomeRules } from '@/lib/league-rules/buildLeagueRulebook'
import { isGuillotineSettingsLeague } from '@/lib/league-settings-home/buildLeagueSettingsHome'
import { readSavedLeagueOverrides } from '@/lib/league-settings/savedLeagueOverrides'
import { useLeagueSettingsSources } from '@/components/league-settings/home/useLeagueSettingsSources'
import { leagueSettingsLabels } from '@/components/league-settings/home/leagueSettingsLabels'
import type { LeagueSettingsModalLeague } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'

/** Bump the version to show the sheet again to everyone (e.g. after its content changes a lot). */
export function rulesWelcomeStorageKey(leagueId: string, userId: string): string {
  return `af:league-rules-welcome:v1:${leagueId}:${userId}`
}

function readSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    // Storage blocked (private window): treat as seen rather than showing the sheet on every visit.
    return true
  }
}

function markSeen(key: string) {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Nothing to do — the sheet simply may show again.
  }
}

/**
 * The one-time welcome sheet on a league's home: the handful of rules that matter most, in plain
 * words, and a way into the full "Rules explained" page. Shown once per manager per league (in
 * this browser), and only once every value it shows has loaded, so it never opens on "…".
 */
export function LeagueRulesWelcome({
  league,
  userId,
  blocked = false,
  onSeeAllRules,
}: {
  league: LeagueSettingsModalLeague
  userId: string
  /** Another sheet or intro is showing; wait for it. */
  blocked?: boolean
  /** Opens League Settings → Rules explained. */
  onSeeAllRules: () => void
}) {
  const key = rulesWelcomeStorageKey(league.id, userId)
  const [seen, setSeen] = useState(true)
  useEffect(() => setSeen(readSeen(key)), [key])

  const guillotine = isGuillotineSettingsLeague(league)
  // Nothing is fetched for a manager who has already seen the sheet.
  const sources = useLeagueSettingsSources(league.id, guillotine, 0, !seen)
  const effectiveLeague = useMemo(() => ({ ...league, ...readSavedLeagueOverrides(league.id) }) as typeof league, [league])
  const ready = !seen && sources.rosterSlots != null && sources.draft != null && (!guillotine || sources.guillotine != null)

  const rules = useMemo(() => {
    if (!ready) return []
    return welcomeRules(
      buildLeagueRulebook({
        league: effectiveLeague,
        ...leagueSettingsLabels(effectiveLeague),
        rosterSlots: sources.rosterSlots,
        draft: sources.draft,
        guillotine: sources.guillotine,
      }),
    )
  }, [ready, effectiveLeague, sources.rosterSlots, sources.draft, sources.guillotine])

  const close = () => {
    markSeen(key)
    setSeen(true)
  }

  if (!ready || blocked || rules.length === 0) return null

  return (
    <AppModal
      open
      onClose={close}
      size="sm"
      title={`How ${league.name?.trim() || 'this league'} works`}
      description="The rules your commissioner chose, in plain words."
      data-testid="league-rules-welcome"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            className="min-h-[44px] rounded-lg border border-white/15 px-4 text-sm font-semibold text-white/80 hover:bg-white/5"
            data-testid="league-rules-welcome-close"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={() => {
              close()
              onSeeAllRules()
            }}
            className="min-h-[44px] rounded-lg bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            data-testid="league-rules-welcome-see-all"
          >
            See all rules
          </button>
        </div>
      }
    >
      <ul className="space-y-3">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid={`league-rules-welcome-${rule.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-white">{rule.label}</span>
              <span className="text-[13px] text-cyan-300">{rule.value}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/65">{rule.meaning}</p>
          </li>
        ))}
      </ul>
    </AppModal>
  )
}
