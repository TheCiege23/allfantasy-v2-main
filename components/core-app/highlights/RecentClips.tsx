'use client'

import { useEffect, useMemo, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { recentClipsMessages } from '@/lib/core-app/messages/recentClips'
import type { XClipsResult } from '@/lib/highlights/x-types'
import XPostEmbed from './XPostEmbed'
import { useHighlightMeasurement } from './useHighlightMeasurement'
import type { HighlightOutcome, HighlightSurface } from '@/lib/analytics/highlights'
import './recent-clips.css'
import { spanishFlag } from '@/lib/core-app/messages/coreLocale'

type ClipRequest =
  | { kind: 'player'; sport: 'NFL'; externalId?: string; sleeperId?: string }
  | { kind: 'roster'; playerIds: string[] }
  | { kind: 'leagues'; leagueIds: string[] }

export default function RecentClips({ request, title, compact = false }: { request: ClipRequest; title: string; compact?: boolean }) {
  const [attempt, setAttempt] = useState(0)
  return <RecentClipsFeed key={JSON.stringify(request) + ':' + attempt} request={request} title={title} compact={compact} onRetry={() => setAttempt(n => n + 1)} />
}

function RecentClipsFeed({ request, title, compact, onRetry }: { request: ClipRequest; title: string; compact: boolean; onRetry: () => void }) {
  const { language } = useOptionalLanguage()
  // XPostEmbed still takes a Spanish flag rather than a language (coreLocale.ts holds the bridge).
  const es = spanishFlag(language)
  const m = useMessages(recentClipsMessages)
  const [result, setResult] = useState<XClipsResult | null>(null)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<'all' | 'play' | 'discussion'>('all')
  const key = JSON.stringify(request)
  useEffect(() => {
    const controller = new AbortController()
    setResult(null); setError(false)
    fetch('/api/core/highlights/clips', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Unavailable')
      const data: XClipsResult = await response.json()
      if (!['ready', 'disabled', 'unavailable'].includes(data.status) || !Array.isArray(data.clips)) throw new Error('Invalid clip response')
      if (!controller.signal.aborted) setResult(data)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [key])
  const surface: HighlightSurface = request.kind === 'player' ? 'player_card' : request.kind === 'roster' ? 'my_team' : 'league_spotlight'
  const outcome = useMemo<HighlightOutcome | null>(() => error ? { status: 'error', clipCount: 0 } : !result || result.status === 'disabled' ? null : { status: result.status === 'unavailable' ? 'unavailable' : result.clips.length ? 'clips' : 'empty', clipCount: result.clips.length }, [error, result])
  const { header, onPostEvent } = useHighlightMeasurement(surface, outcome)
  // Keep unconfigured pilot surfaces out of the released product.
  if (result?.status === 'disabled') return null
  const clips = result?.clips.filter(c => filter === 'all' || (filter === 'play' ? c.kind === 'play' : c.kind !== 'play')) ?? []
  return <section className={'af-recent-clips' + (compact ? ' af-recent-clips-compact' : '')} aria-label={title}>
    <header ref={header}><h3>{title}</h3><span>{m.xPosts}</span></header>
    <p className="af-x-note">{m.matchNote}</p>
    {!compact ? <label className="af-x-filter">{m.show} <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
      <option value="all">{m.allClips}</option>
      <option value="play">{m.plays}</option>
      <option value="discussion">{m.interviewsCommentary}</option>
    </select></label> : null}
    <div role="status" aria-live="polite">
      {error ? <p>{m.loadFailed} <button type="button" onClick={onRetry}>{m.retry}</button></p>
        : !result ? <p>{m.finding}</p>
        : result.status === 'unavailable' ? <p>{m.unavailable}</p>
        : !clips.length ? <p>{m.noMatches}</p> : null}
    </div>
    <div className="af-x-grid">{clips.map(clip => <article key={key + ':' + clip.id} className="af-x-card">
      <div className="af-x-badges">
        {clip.leagues.map(league => <a key={league.id} href={'/core?league=' + encodeURIComponent(league.id)}>{league.name}</a>)}
        <span>{clip.kind === 'play' ? m.kindPlay : clip.kind === 'interview' ? m.kindInterview : m.kindCommentary}</span>
      </div>
      <h4>{clip.players.map(p => p.name).join(' · ')}</h4>
      <p className="af-x-caption">{clip.text}</p>
      <p className="af-x-note">@{clip.account} · <time dateTime={clip.publishedAt}>{new Date(clip.publishedAt).toLocaleString(m.timeLocale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></p>
      <XPostEmbed post={clip} es={es} onEvent={onPostEvent} />
    </article>)}</div>
    {result?.checkedAt ? <p className="af-x-note">{m.feedChecked} <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleTimeString(m.timeLocale, { hour: 'numeric', minute: '2-digit' })}</time> · {m.hourlyRefresh}</p> : null}
    <p className="af-x-note">{m.privacyNote} <a href="https://help.x.com/en/x-for-websites-ads-info-and-privacy" target="_blank" rel="noopener noreferrer">{m.xPrivacy}</a></p>
  </section>
}

