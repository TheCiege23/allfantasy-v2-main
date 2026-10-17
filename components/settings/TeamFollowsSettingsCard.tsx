'use client'

import { useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { sportLabelKey, useTeamFollows } from '@/components/follows/useTeamFollows'

/**
 * Settings › Notifications › "Teams you follow" (owner's call, 2026-10-03): the permanent home for
 * the choices the one-time My Team prompt asks for. Following a team sends its news and injury
 * updates — for the team and the players on it, not the whole league — under the "Teams you follow"
 * alert switch below, capped per day at the sender.
 *
 * Hidden entirely when follows are unavailable on the server, rather than reading "you follow none".
 */
export default function TeamFollowsSettingsCard() {
  const { t, tInterpolate } = useOptionalLanguage()
  const tf = useTeamFollows('NFL')
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  if (tf.available === false) return null

  const bySport = new Map<string, NonNullable<typeof tf.follows>>()
  for (const f of tf.follows ?? []) {
    if (!bySport.has(f.sport)) bySport.set(f.sport, [])
    bySport.get(f.sport)!.push(f)
  }
  const q = query.trim().toLowerCase()
  const shown = (tf.teams ?? []).filter((team) => !q || team.name.toLowerCase().includes(q) || team.abbr.toLowerCase() === q)

  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
      aria-labelledby="team-follows-title"
      data-testid="settings-team-follows"
    >
      <div>
        <h3 id="team-follows-title" className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {t('follows.settings.title')}
        </h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          {t('follows.settings.body')}
        </p>
      </div>

      {tf.loadError ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-xs" style={{ color: 'var(--muted2)' }}>
            {t('follows.prompt.loadError')}
          </p>
          <button
            type="button"
            onClick={() => void tf.reload()}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            {t('follows.settings.retry')}
          </button>
        </div>
      ) : tf.follows === null ? null : (
        <>
          {tf.follows.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--muted)' }} data-testid="team-follows-empty">
              {t('follows.settings.none')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="team-follows-list">
              {[...bySport.entries()].map(([sport, list]) => (
                <li key={sport}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted2)' }}>
                    {t(sportLabelKey(sport))}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {list.map((f) => (
                      <span
                        key={f.teamAbbr}
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      >
                        {f.teamName}
                        <button
                          type="button"
                          onClick={() => void tf.toggle(sport, { abbr: f.teamAbbr, name: f.teamName })}
                          aria-label={tInterpolate('follows.settings.unfollowAria', { team: f.teamName })}
                          className="ml-0.5 grid h-5 w-5 place-items-center rounded-full"
                          style={{ color: 'var(--muted)' }}
                          data-testid={`team-follows-remove-${sport}-${f.teamAbbr}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              data-testid="team-follows-add"
            >
              {t('follows.settings.add')}
            </button>
          ) : (
            <div className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('follows.prompt.sportsAria')}>
                {tf.sports.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={tf.sport === s}
                    onClick={() => {
                      tf.setSport(s)
                      setQuery('')
                    }}
                    className="rounded-full border px-2.5 py-1 text-xs font-medium"
                    style={{
                      borderColor: tf.sport === s ? 'var(--accent-cyan)' : 'var(--border)',
                      color: tf.sport === s ? 'var(--accent-cyan)' : 'var(--muted)',
                    }}
                  >
                    {t(sportLabelKey(s))}
                  </button>
                ))}
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('follows.prompt.search')}
                aria-label={t('follows.prompt.search')}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
              />
              <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
                {tf.teams === null ? (
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    {t('follows.prompt.loading')}
                  </p>
                ) : (
                  shown.map((team) => {
                    const on = tf.isFollowing(tf.sport, team.abbr)
                    return (
                      <button
                        key={team.abbr}
                        type="button"
                        aria-pressed={on}
                        onClick={() => void tf.toggle(tf.sport, team)}
                        className="rounded-lg border px-2.5 py-1.5 text-xs"
                        style={{
                          borderColor: on ? 'var(--accent-cyan)' : 'var(--border)',
                          color: 'var(--text)',
                        }}
                        data-testid={`team-follows-pick-${tf.sport}-${team.abbr}`}
                      >
                        {on ? '★ ' : ''}
                        {team.name}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {tf.saveError ? (
            <p role="alert" className="text-xs" style={{ color: 'var(--accent-red-strong, #fb7185)' }}>
              {tf.saveError === 'save' ? t('follows.prompt.saveError') : tf.saveError}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
