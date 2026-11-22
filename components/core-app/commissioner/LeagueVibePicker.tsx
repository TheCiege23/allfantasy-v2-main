'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LEAGUE_VIBES, MAX_LEAGUE_VIBES, type LeagueVibe } from '@/lib/public-discovery/vibes'

/**
 * "What's it like in here?" — up to three vibe tags for Find a League, inside the listing cards.
 * Saves on each tap through /api/commissioner/leagues/[id]/vibes, so there is no extra button.
 */
export function LeagueVibePicker({ leagueId }: { leagueId: string }) {
  const { t } = useOptionalLanguage()
  const url = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}/vibes`
  const [vibes, setVibes] = useState<LeagueVibe[] | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(url, { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { vibes?: LeagueVibe[] } | null) => {
        if (!cancelled && d) setVibes(Array.isArray(d.vibes) ? d.vibes : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [url])

  if (!vibes) return null

  const toggle = async (vibe: LeagueVibe) => {
    const next = vibes.includes(vibe) ? vibes.filter((v) => v !== vibe) : [...vibes, vibe]
    if (next.length > MAX_LEAGUE_VIBES) {
      setStatus(t('Pick up to three.'))
      return
    }
    const previous = vibes
    setVibes(next)
    setStatus('')
    try {
      const r = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibes: next }),
      })
      if (!r.ok) throw new Error()
      setStatus(t('Saved.'))
    } catch {
      setVibes(previous)
      setStatus(t('That did not save. Try again.'))
    }
  }

  return (
    <div className="space-y-1.5" data-testid="league-vibe-picker">
      <p className="text-xs font-semibold">{t("What's it like in here? Pick up to three.")}</p>
      <div className="flex flex-wrap gap-2">
        {LEAGUE_VIBES.map((v) => {
          const on = vibes.includes(v.id)
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => void toggle(v.id)}
              className="min-h-[36px] rounded-full border px-3 text-xs font-semibold"
              style={{ borderColor: on ? 'var(--accent, #7c3aed)' : 'currentColor', opacity: on ? 1 : 0.7 }}
            >
              {t(v.label)}
            </button>
          )
        })}
      </div>
      <p role="status" className="text-xs">
        {status}
      </p>
    </div>
  )
}
