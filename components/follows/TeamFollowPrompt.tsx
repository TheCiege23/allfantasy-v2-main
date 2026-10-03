'use client'

import { useEffect, useRef, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { dismissTeamFollowPrompt, sportLabelKey, useTeamFollows } from '@/components/follows/useTeamFollows'

/**
 * "Follow your teams" — shown once on My Team (owner's call, 2026-10-03: once for every existing
 * user, then for each new user after sign-up). Picks save as they are tapped; "Done" and "Not now"
 * both record the prompt as seen, so it never comes back. Settings › Notifications › "Teams you
 * follow" is the permanent home for the same choices.
 *
 * Whether to show it is decided on the SERVER (`shouldShowTeamFollowPrompt`, from the shell's
 * read): never seen, follows none, and follows available. This component only renders `eligible`.
 *
 * A real modal: focus lands inside, Escape means "Not now", the page does not scroll behind it.
 */

export function TeamFollowPrompt({ eligible }: { eligible: boolean }) {
  const [open, setOpen] = useState(eligible)
  useEffect(() => setOpen(eligible), [eligible])
  if (!open) return null
  return <TeamFollowPromptDialog onClose={() => setOpen(false)} />
}

function TeamFollowPromptDialog({ onClose }: { onClose: () => void }) {
  const { t, tInterpolate } = useOptionalLanguage()
  const tf = useTeamFollows('NFL')
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  const close = () => {
    dismissTeamFollowPrompt()
    onClose()
  }

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('button, input')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // `close` is stable enough for a mount-only effect; re-binding per render would refocus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follows unavailable on this server (no table yet): nothing to offer, so do not interrupt. Closed
  // from an effect — calling the parent's setter during render is a React error.
  useEffect(() => {
    if (tf.available === false) onClose()
  }, [tf.available, onClose])
  if (tf.available === false) return null

  const q = query.trim().toLowerCase()
  const shown = (tf.teams ?? []).filter((team) => !q || team.name.toLowerCase().includes(q) || team.abbr.toLowerCase() === q)
  const count = tf.follows?.length ?? 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="af-team-follow-title"
      data-testid="team-follow-prompt"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.6)',
      }}
    >
      <div
        ref={panelRef}
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: 'min(640px, calc(100vh - 32px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 20,
          borderRadius: 16,
          border: '1px solid var(--line2, rgba(255,255,255,0.12))',
          background: 'var(--surface, #0f1720)',
          color: 'var(--text, #fff)',
        }}
      >
        <div>
          <h2 id="af-team-follow-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {t('follows.prompt.title')}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text2, #b6c2cf)' }}>{t('follows.prompt.body')}</p>
        </div>

        <div role="tablist" aria-label={t('follows.prompt.sportsAria')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(tf.sports.length ? tf.sports : ['NFL']).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={tf.sport === s}
              onClick={() => {
                tf.setSport(s)
                setQuery('')
              }}
              data-testid={`team-follow-sport-${s}`}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--line2, rgba(255,255,255,0.12))',
                background: tf.sport === s ? 'var(--accent-soft, rgba(34,211,238,0.15))' : 'transparent',
                color: tf.sport === s ? 'var(--accent, #22d3ee)' : 'var(--text2, #b6c2cf)',
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
          style={{
            padding: '8px 10px',
            borderRadius: 10,
            fontSize: 14,
            border: '1px solid var(--line2, rgba(255,255,255,0.12))',
            background: 'var(--chip, rgba(255,255,255,0.04))',
            color: 'var(--text, #fff)',
          }}
        />

        <div style={{ overflowY: 'auto', minHeight: 120, display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start' }}>
          {tf.loadError ? (
            <p role="alert" style={{ fontSize: 13, color: 'var(--text2, #b6c2cf)' }}>
              {t('follows.prompt.loadError')}
            </p>
          ) : tf.teams === null ? (
            <p style={{ fontSize: 13, color: 'var(--text2, #b6c2cf)' }}>{t('follows.prompt.loading')}</p>
          ) : (
            shown.map((team) => {
              const on = tf.isFollowing(tf.sport, team.abbr)
              return (
                <button
                  key={team.abbr}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void tf.toggle(tf.sport, team)}
                  data-testid={`team-follow-${tf.sport}-${team.abbr}`}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 10,
                    fontSize: 13,
                    border: `1px solid ${on ? 'var(--accent, #22d3ee)' : 'var(--line2, rgba(255,255,255,0.12))'}`,
                    background: on ? 'var(--accent-soft, rgba(34,211,238,0.15))' : 'transparent',
                    color: 'var(--text, #fff)',
                  }}
                >
                  {on ? '★ ' : ''}
                  {team.name}
                </button>
              )
            })
          )}
        </div>

        {tf.saveError ? (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--bad, #fb7185)' }}>
            {tf.saveError === 'save' ? t('follows.prompt.saveError') : tf.saveError}
          </p>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text2, #b6c2cf)' }} data-testid="team-follow-count">
            {tInterpolate('follows.prompt.count', { count: String(count) })}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={close}
              data-testid="team-follow-not-now"
              style={{ padding: '8px 12px', borderRadius: 10, fontSize: 13, background: 'transparent', color: 'var(--text2, #b6c2cf)', border: '1px solid var(--line2, rgba(255,255,255,0.12))' }}
            >
              {t('follows.prompt.notNow')}
            </button>
            <button
              type="button"
              onClick={close}
              data-testid="team-follow-done"
              style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, background: 'var(--accent, #22d3ee)', color: 'var(--accent-ink, #06202a)', border: 'none' }}
            >
              {t('follows.prompt.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
