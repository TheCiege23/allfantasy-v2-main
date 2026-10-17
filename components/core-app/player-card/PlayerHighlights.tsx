'use client'

import { useHighlightCopy } from './highlightCopy'

import { useEffect, useRef, useState } from 'react'
import type { PlayerCardIdentity } from '@/lib/core-app/playerCard'
import type { PlayerHighlightsResult } from '@/lib/highlights/types'
import HighlightVideos from './HighlightVideos'

export default function PlayerHighlights({ player }: { player: PlayerCardIdentity }) {
  if (player.sport.toUpperCase() !== 'NFL') return null
  return <NflPlayerHighlights key={`${player.sport}:${player.externalId}:${player.sleeperId ?? ''}`} player={player} />
}

function NflPlayerHighlights({ player }: { player: PlayerCardIdentity }) {
  const { language, copy } = useHighlightCopy()
  const [result, setResult] = useState<PlayerHighlightsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  // The keyed child drops the previous player's clips and cancels in-flight requests.
  useEffect(() => () => { controller.current?.abort() }, [])

  async function load() {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setError(false)
    const params = new URLSearchParams({ sport: player.sport })
    if (player.externalId) {
      params.set('externalId', player.externalId)
      // An externalId is only unique per feed; without the source the route refuses an ambiguous id.
      if (player.source) params.set('source', player.source)
    } else if (player.sleeperId) params.set('sleeperId', player.sleeperId)
    try {
      const response = await fetch(`/api/core/player-card/highlights?${params}`, { signal: request.signal })
      if (!response.ok) throw new Error('Highlights unavailable')
      const data: PlayerHighlightsResult = await response.json()
      if (!request.signal.aborted) setResult(data)
    } catch {
      if (!request.signal.aborted) setError(true)
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }

  return (
    <section className="af-pc-highlights" aria-label={language === 'es' ? `Videos de ${player.name}` : `${player.name} highlights`}>
      <div className="af-pc-label">{copy("HIGHLIGHTS · YouTube")}</div>
      <p className="af-pc-faint">{language === 'es' ? `Publicaciones recientes del canal oficial de la NFL. Los resúmenes de equipo pueden no mostrar a ${player.name}.` : `Recent official NFL uploads. Team recaps may not feature ${player.name}.`}</p>
      {!result || result.status === 'unavailable' ? (
        <button className="af-pc-highlights-load" type="button" onClick={load} disabled={loading}>
          {loading ? copy("Finding highlights…") : error || result ? copy("Try highlights again") : copy("Find highlights")}
        </button>
      ) : null}
      <div role="status" aria-live="polite">
        {error ? <p className="af-pc-absent">{copy("Highlights could not be loaded. Please try again later.")}</p> : null}
        {result?.message ? <p className="af-pc-absent">{copy(result.message)}</p> : null}
      </div>
      <HighlightVideos videos={result?.videos ?? []} />
      <p className="af-pc-highlight-disclosure">
        {copy("Finding highlights loads YouTube thumbnails. Videos open on YouTube in a new tab.")}
        {' '}<a href="/privacy#youtube-highlights">{copy("Privacy")}</a>
        {' · '}<a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">{copy("YouTube Terms")}</a>
      </p>
    </section>
  )
}
