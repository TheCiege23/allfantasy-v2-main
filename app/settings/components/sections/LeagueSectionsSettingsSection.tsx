'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HIDDEN_LEAGUE_SECTIONS_KEY, LEAGUE_SECTIONS, readHiddenLeagueSections, type LeagueSectionId } from '@/lib/league/leagueSections'
import type { SettingsProfile } from './settings-types'

export function LeagueSectionsSettingsSection({ profile, onRefetch }: { profile: SettingsProfile; onRefetch: () => void }) {
  const { t, tInterpolate } = useLanguage()
  const [hidden, setHidden] = useState(() => readHiddenLeagueSections(profile?.notificationPreferences))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const latest = useRef(hidden)
  const confirmed = useRef(hidden)
  const queue = useRef(Promise.resolve())
  const pending = useRef(0)

  useEffect(() => {
    if (pending.current) return
    const next = readHiddenLeagueSections(profile?.notificationPreferences)
    latest.current = confirmed.current = next
    setHidden(next)
  }, [profile?.notificationPreferences])

  const save = (next: LeagueSectionId[]) => {
    latest.current = next
    setHidden(next)
    pending.current += 1
    setStatus('saving')
    // Serialize writes so rapid phone taps cannot leave an older choice on the server.
    queue.current = queue.current.then(async () => {
      let ok = false
      try {
        ok = (await fetch('/api/user/profile', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notificationPreferences: { [HIDDEN_LEAGUE_SECTIONS_KEY]: next } }),
        })).ok
      } catch { /* Roll back to the last confirmed choice below. */ }
      pending.current -= 1
      if (ok) confirmed.current = next
      if (pending.current === 0) {
        if (!ok) { latest.current = confirmed.current; setHidden(confirmed.current) }
        setStatus(ok ? 'saved' : 'error')
        if (ok) onRefetch()
      }
    })
  }

  return <div className="space-y-5" data-testid="settings-league-sections">
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{t('settings.leagues.title')}</h2>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('settings.leagues.intro')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">{tInterpolate('settings.home.count', { shown: LEAGUE_SECTIONS.length - hidden.length, total: LEAGUE_SECTIONS.length })}</span>
        <button type="button" className="min-h-[44px] rounded-lg border px-3 text-sm disabled:opacity-40" disabled={!hidden.length} onClick={() => save([])}>{t('settings.home.showAll')}</button>
        <span role="status" aria-live="polite" className="text-sm" style={{ color: status === 'error' ? 'var(--accent-red-strong, #fb5b78)' : 'var(--muted)' }}>
          {status === 'idle' ? '' : t(`settings.home.${status === 'error' ? 'saveFailed' : status}`)}
        </span>
      </div>
    </div>
    <ul className="space-y-2">{LEAGUE_SECTIONS.map(id => {
      const visible = !hidden.includes(id)
      const title = t(`settings.leagues.section.${id}.title`)
      return <li key={id}><label className="af-home-section-row flex min-h-[64px] cursor-pointer items-center gap-3 rounded-xl px-4 py-3" data-shown={String(visible)} data-league-section={id}>
        <span className="min-w-0 flex-1"><span className="text-sm font-bold">{title}</span>
          <span className="mt-1 block text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>{t(`settings.leagues.section.${id}.desc`)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <input type="checkbox" role="switch" checked={visible} aria-label={tInterpolate('settings.home.switchAria', { section: title })}
            onChange={e => save(LEAGUE_SECTIONS.filter(key => key === id ? !e.target.checked : latest.current.includes(key)))} />
          <span className="text-xs font-bold">{t(`settings.home.${visible ? 'on' : 'off'}`)}</span>
        </span>
      </label></li>
    })}</ul>
    <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('settings.leagues.footnote')}</p>
  </div>
}
