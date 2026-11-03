'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreLang } from '@/lib/core-app/messages/coreLocale'
import { postWithTokenConfirm } from '@/lib/tokens/clientTokenConfirm'
import { formatForPlatform, platformDisplayName } from '@/lib/storyline-studio/copyFormat'
import { studioCopy, WEEKDAY_NAMES } from '@/lib/storyline-studio/studioCopy'
import type { StoryHook } from '@/lib/storyline-studio/types'

/**
 * Storyline Studio card on the Commissioner Hub (AF Commissioner).
 *
 * Every hook arrives with its text already written from facts; the commissioner can edit it, ask for
 * an AI tone pass (billed separately, fact-guarded on the server), copy it, post it to the league chat
 * and add the matchup's prediction poll. Imported leagues get Copy only — their chat is on the host
 * platform — and the auto-post switch is shown disabled with the reason. The route enforces all of it.
 */

type Tone = 'template' | 'announcer' | 'trash_talk' | 'neutral'

type Settings = {
  autoPost: boolean
  includePoll: boolean
  weekday: number
  hour: number
  timeZone: string
  enabledByYou: boolean
  posted: Record<string, { at: string; messageId: string; hookId: string; auto: boolean }>
}

type View =
  | { entitled: false; native: boolean; platform: string; upgradePath: string | null }
  | {
      entitled: true
      native: boolean
      platform: string
      season: number
      week: number | null
      teams: Record<string, string>
      hooks: {
        byMatchup: Array<{ matchup: { a: string; b: string; matchupId?: string }; hooks: StoryHook[] }>
        league: StoryHook[]
      }
      settings: Settings
    }

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

export function StorylineStudio({ leagueId }: { leagueId: string }) {
  const { language } = useOptionalLanguage()
  const lang = coreLang(language)
  const t = (english: string) => studioCopy(english, language)
  const endpoint = `/api/leagues/${encodeURIComponent(leagueId)}/storylines`

  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetch(`${endpoint}?lang=${lang}`, { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as View | { error?: string } | null
        if (!live) return
        if (res.ok && body && 'entitled' in body) setView(body)
        else setError(t('Could not load storylines.'))
      })
      .catch(() => live && setError(t('Could not load storylines.')))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, lang])

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      setBusy(true)
      setMessage(null)
      try {
        const res = await fetch(endpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(patch),
        })
        const body = (await res.json().catch(() => null)) as { settings?: Settings; error?: string } | null
        if (!res.ok || !body?.settings) {
          setMessage(t('Could not save.'))
          return
        }
        setView((v) => (v && v.entitled ? { ...v, settings: body.settings! } : v))
        setMessage(t('Saved.'))
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint],
  )

  if (error) return <p className="af-ch-muted">{error}</p>
  if (!view) return <p className="af-ch-muted">{t('Loading storylines…')}</p>

  if (!view.entitled) {
    return (
      <div className="af-ss" data-testid="storyline-studio-upsell">
        <p className="af-ch-recipe-label">{t('Storyline Studio is part of AF Commissioner.')}</p>
        <p className="af-ch-recipe-desc">
          {t('Weekly rivalry records, revenge games, draft steals and more — ready to post or copy into your league chat.')}
        </p>
        <Link className="af-btn" href={view.upgradePath || '/pricing'}>
          {t('Get AF Commissioner')}
        </Link>
      </div>
    )
  }

  const s = view.settings
  const lastAuto = Object.values(s.posted)
    .filter((p) => p.auto)
    .sort((a, b) => b.at.localeCompare(a.at))[0]
  const empty = view.hooks.byMatchup.length === 0 && view.hooks.league.length === 0

  return (
    <div className="af-ss" data-testid="storyline-studio">
      <p className="af-ch-recipe-desc">
        {t('Fact-based trash talk for this week’s matchups, built from your league’s own results. Every number comes from your league’s data.')}
      </p>

      {/* ── Auto-post ─────────────────────────────────────────────── */}
      <ul className="af-ch-recipe-list">
        <li data-on={view.native && s.autoPost}>
          <div className="af-ch-recipe-body">
            <p className="af-ch-recipe-label">{t('Auto-post storylines')}</p>
            <p className="af-ch-recipe-desc">
              {view.native
                ? t('Once a week, the top storyline goes into the league chat at the time you choose.')
                : t(
                    'Auto-post is available in AllFantasy leagues. For leagues on Sleeper/ESPN/etc., copy and paste the storyline into your league chat.',
                  )}
            </p>
            {view.native && lastAuto ? (
              <p className="af-ch-recipe-meta">
                {t('Last auto-post:')} {new Date(lastAuto.at).toLocaleString(lang)}
              </p>
            ) : null}
          </div>
          <label className="af-ch-switch">
            <input
              type="checkbox"
              role="switch"
              checked={view.native && s.autoPost}
              disabled={busy || !view.native}
              aria-label={t('Auto-post storylines')}
              data-testid="storyline-autopost-toggle"
              onChange={(e) =>
                saveSettings(e.target.checked ? { autoPost: true, timeZone: s.enabledByYou ? s.timeZone : browserTimeZone() } : { autoPost: false })
              }
            />
            <span aria-hidden className="af-ch-switch-track">
              <span className="af-ch-switch-thumb" />
            </span>
          </label>
        </li>
        {view.native ? (
          <li>
            <div className="af-ss-schedule">
              <label>
                <input
                  type="checkbox"
                  checked={s.includePoll}
                  disabled={busy}
                  onChange={(e) => saveSettings({ includePoll: e.target.checked })}
                />{' '}
                {t('Include a prediction poll')}
              </label>
              <label>
                {t('Day')}{' '}
                <select value={s.weekday} disabled={busy} onChange={(e) => saveSettings({ weekday: Number(e.target.value) })}>
                  {WEEKDAY_NAMES[lang].map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('Time')}{' '}
                <select value={s.hour} disabled={busy} onChange={(e) => saveSettings({ hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {new Date(2020, 0, 1, h).toLocaleTimeString(lang, { hour: 'numeric' })}
                    </option>
                  ))}
                </select>
              </label>
              <span className="af-ch-recipe-meta">{s.timeZone}</span>
            </div>
          </li>
        ) : null}
      </ul>
      {message ? <p className="af-ch-muted" role="status">{message}</p> : null}

      {/* ── This week's hooks ─────────────────────────────────────── */}
      {view.week != null ? (
        <h4 className="af-ch-recipe-label af-ss-week">
          {t('Week')} {view.week} · {view.season}
        </h4>
      ) : null}
      {empty ? <p className="af-ch-recipe-desc">{t('No head-to-head games this week, and nothing league-wide to say yet.')}</p> : null}

      {view.hooks.byMatchup.map(({ matchup, hooks }) => (
        <section key={`${matchup.a}|${matchup.b}`} className="af-ss-matchup">
          <h5 className="af-ss-matchup-title">
            {view.teams[matchup.a] ?? '—'} <span className="af-ss-vs">vs</span> {view.teams[matchup.b] ?? '—'}
          </h5>
          {hooks.length === 0 ? (
            <p className="af-ch-recipe-desc">{t('No storyline for this matchup yet — there is no history between these teams in the data.')}</p>
          ) : (
            hooks.map((h) => (
              <HookCard key={h.id} hook={h} leagueId={leagueId} native={view.native} platform={view.platform} lang={lang} />
            ))
          )}
        </section>
      ))}

      {view.hooks.league.length > 0 ? (
        <section className="af-ss-matchup">
          <h5 className="af-ss-matchup-title">{t('League-wide')}</h5>
          {view.hooks.league.map((h) => (
            <HookCard key={h.id} hook={h} leagueId={leagueId} native={view.native} platform={view.platform} lang={lang} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

function HookCard({
  hook,
  leagueId,
  native,
  platform,
  lang,
}: {
  hook: StoryHook
  leagueId: string
  native: boolean
  platform: string
  lang: 'en' | 'es'
}) {
  const t = (english: string) => studioCopy(english, lang)
  const [text, setText] = useState(hook.text)
  const [tone, setTone] = useState<Tone>('template')
  const [state, setState] = useState<'idle' | 'rewriting' | 'posting' | 'polling'>('idle')
  const [done, setDone] = useState<{ copied?: boolean; posted?: boolean; poll?: boolean }>({})
  const [note, setNote] = useState<string | null>(null)
  const sources = useMemo(() => [...new Set(hook.facts.map((f) => f.source).filter((s) => s !== 'template'))], [hook.facts])

  async function changeTone(next: Tone) {
    setTone(next)
    setNote(null)
    if (next === 'template') {
      setText(hook.text)
      return
    }
    setState('rewriting')
    try {
      const { response, declined } = await postWithTokenConfirm(
        `/api/leagues/${encodeURIComponent(leagueId)}/storylines/rewrite`,
        { hookId: hook.id, tone: next, lang },
      )
      if (declined) {
        setTone('template')
        return
      }
      const body = (await response.json().catch(() => ({}))) as { text?: string; source?: string; message?: string; error?: string }
      if (!response.ok) {
        setNote(body.message || body.error || t('Could not post.'))
        setTone('template')
        return
      }
      setText(body.text ?? hook.text)
      if (body.source !== 'ai') setNote(t('The AI rewrite did not hold to the facts, so the template is shown instead.'))
    } finally {
      setState('idle')
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatForPlatform(text, native ? 'allfantasy' : platform))
      setDone((d) => ({ ...d, copied: true }))
    } catch {
      setNote(formatForPlatform(text, platform))
    }
  }

  async function post() {
    setState('posting')
    setNote(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/storylines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'post', hookId: hook.id, text, lang }),
      })
      if (res.ok) setDone((d) => ({ ...d, posted: true }))
      else setNote(t('Could not post.'))
    } finally {
      setState('idle')
    }
  }

  async function addPoll() {
    if (!hook.matchup?.matchupId) return
    setState('polling')
    setNote(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/predictions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ matchupId: hook.matchup.matchupId }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.ok) setDone((d) => ({ ...d, poll: true }))
      else setNote(body.error || t('Could not post.'))
    } finally {
      setState('idle')
    }
  }

  return (
    <article className="af-ss-hook" data-kind={hook.kind} data-testid="storyline-hook">
      <textarea
        className="af-ss-text"
        value={text}
        maxLength={1000}
        rows={3}
        aria-label={t('Edit before posting')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="af-ss-actions">
        <label className="af-ss-tone">
          {t('Tone')}{' '}
          <select value={tone} disabled={state !== 'idle'} onChange={(e) => void changeTone(e.target.value as Tone)}>
            <option value="template">{t('Template')}</option>
            <option value="announcer">{t('Announcer')}</option>
            <option value="trash_talk">{t('Trash talk')}</option>
            <option value="neutral">{t('Neutral')}</option>
          </select>
        </label>
        <button type="button" className="af-btn af-btn--ghost" onClick={() => void copy()}>
          {done.copied ? t('Copied') : t('Copy')}
        </button>
        {native ? (
          <>
            <button type="button" className="af-btn" disabled={state !== 'idle' || done.posted} onClick={() => void post()}>
              {done.posted ? t('Posted') : t('Post to league chat')}
            </button>
            {hook.matchup?.matchupId ? (
              <button type="button" className="af-btn af-btn--ghost" disabled={state !== 'idle' || done.poll} onClick={() => void addPoll()}>
                {done.poll ? t('Poll added') : t('Add poll')}
              </button>
            ) : null}
          </>
        ) : (
          <span className="af-ch-recipe-meta">{platformDisplayName(platform)}</span>
        )}
      </div>
      {state === 'rewriting' ? <p className="af-ch-muted">{t('Rewriting…')}</p> : null}
      {note ? <p className="af-ch-muted" role="status">{note}</p> : null}
      {sources.length > 0 ? (
        <p className="af-ss-sources">
          {t('Sources:')} {sources.join(' · ')}
        </p>
      ) : null}
    </article>
  )
}

export default StorylineStudio
