'use client'

import { useEffect, useMemo, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { XClipsResult } from '@/lib/highlights/x-types'
import XPostEmbed from './XPostEmbed'
import { useHighlightMeasurement } from './useHighlightMeasurement'
import type { HighlightOutcome, HighlightSurface } from '@/lib/analytics/highlights'
import './recent-clips.css'

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
  const es = language === 'es'
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
    <header ref={header}><h3>{title}</h3><span>{es ? 'Publicaciones de X' : 'X posts'}</span></header>
    <p className="af-x-note">{es ? 'Coincidencias por nombre o usuario verificado en el texto; no confirman quién aparece en el video.' : 'Matched by full name or verified handle in the caption; this does not confirm who appears in the video.'}</p>
    {!compact ? <label className="af-x-filter">{es ? 'Mostrar' : 'Show'} <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
      <option value="all">{es ? 'Todos los clips' : 'All clips'}</option>
      <option value="play">{es ? 'Jugadas' : 'Plays'}</option>
      <option value="discussion">{es ? 'Entrevistas y comentarios' : 'Interviews & commentary'}</option>
    </select></label> : null}
    <div role="status" aria-live="polite">
      {error ? <p>{es ? 'No se pudieron cargar los clips.' : 'Clips could not be loaded.'} <button type="button" onClick={onRetry}>{es ? 'Reintentar' : 'Retry'}</button></p>
        : !result ? <p>{es ? 'Buscando clips recientes…' : 'Finding recent clips…'}</p>
        : result.status === 'unavailable' ? <p>{es ? 'El feed de clips no está disponible temporalmente.' : 'The clip feed is temporarily unavailable.'}</p>
        : !clips.length ? <p>{es ? 'No hay clips coincidentes de las últimas 24 horas.' : 'No matching clips from the last 24 hours.'}</p> : null}
    </div>
    <div className="af-x-grid">{clips.map(clip => <article key={key + ':' + clip.id} className="af-x-card">
      <div className="af-x-badges">
        {clip.leagues.map(league => <a key={league.id} href={'/core?league=' + encodeURIComponent(league.id)}>{league.name}</a>)}
        <span>{clip.kind === 'play' ? (es ? 'Jugada' : 'Play') : clip.kind === 'interview' ? (es ? 'Entrevista' : 'Interview') : (es ? 'Comentario' : 'Commentary')}</span>
      </div>
      <h4>{clip.players.map(p => p.name).join(' · ')}</h4>
      <p className="af-x-caption">{clip.text}</p>
      <p className="af-x-note">@{clip.account} · <time dateTime={clip.publishedAt}>{new Date(clip.publishedAt).toLocaleString(es ? 'es' : 'en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></p>
      <XPostEmbed post={clip} es={es} onEvent={onPostEvent} />
    </article>)}</div>
    {result?.checkedAt ? <p className="af-x-note">{es ? 'Feed actualizado' : 'Feed checked'} <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleTimeString(es ? 'es' : 'en', { hour: 'numeric', minute: '2-digit' })}</time> · {es ? 'Actualización cada hora' : 'Hourly pilot refresh'}</p> : null}
    <p className="af-x-note">{es ? 'Al cargar una publicación, X recibe datos del navegador. Algunos videos solo se reproducen en X.' : 'Loading a post shares browser data with X. Some videos only play on X.'} <a href="https://help.x.com/en/x-for-websites-ads-info-and-privacy" target="_blank" rel="noopener noreferrer">{es ? 'Privacidad de X' : 'X privacy'}</a></p>
  </section>
}

