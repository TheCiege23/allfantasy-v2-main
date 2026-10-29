'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'
import { EpisodeCard } from '@/app/survivor/components/EpisodeCard'
import type { SurvivorEpisode } from '@/lib/survivor/survivorEpisode'

/** The season so far, one episode per week, from the recaps the island has already posted. */
export default function SurvivorEpisodesPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const [episodes, setEpisodes] = useState<SurvivorEpisode[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [revealed, setRevealed] = useState<Array<{ id: string; author: string; text: string; createdAt: string }> | null>(null)

  useEffect(() => {
    if (!leagueId) return
    let live = true
    fetch(`/api/survivor/episodes?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('episodes'))))
      .then((json: { episodes?: SurvivorEpisode[] }) => { if (live) setEpisodes(Array.isArray(json.episodes) ? json.episodes : []) })
      .catch(() => { if (live) setFailed(true) })
    // After the finale every confessional is revealed; before it, this stays null.
    fetch(`/api/survivor/confessionals?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((json: { revealed?: Array<{ id: string; author: string; text: string; createdAt: string }> | null } | null) => { if (live) setRevealed(json?.revealed ?? null) })
      .catch(() => {})
    return () => { live = false }
  }, [leagueId])

  const scene = (episode: SurvivorEpisode, label: string) => episode.scenes.find(s => s.label === label)?.text

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10" data-testid="survivor-episodes-page">
      <section className="survivor-panel rounded-2xl p-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/45">Season timeline</p>
        <h1 className="mt-1 text-xl font-bold text-white">{ctx.leagueName}</h1>
        <p className="mt-2 text-[13px] text-white/55">
          {episodes ? `${episodes.length} episode${episodes.length === 1 ? '' : 's'} so far` : 'Loading the season…'}
        </p>
      </section>

      {failed ? <p role="alert" className="mt-4 text-sm text-red-200">The episodes could not be loaded. Try again in a moment.</p> : null}
      {episodes && episodes.length === 0 ? (
        <p className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4 text-[13px] text-white/60">
          The first episode posts after the first week&apos;s scores are final and Tribal Council has been read.
        </p>
      ) : null}

      {revealed && revealed.length ? (
        <section className="survivor-panel mt-6 rounded-2xl p-5" data-testid="confessional-reveal">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-200">The confessional reveal</p>
          <h2 className="mt-1 text-lg font-bold text-white">What everyone was really thinking</h2>
          <ul className="mt-3 space-y-2">
            {revealed.map(row => (
              <li key={row.id} className="rounded-lg border border-white/10 bg-black/25 p-3 text-[13px] text-white/80">
                <span className="font-semibold text-amber-100">{row.author}</span>
                <time className="ml-2 text-[11px] text-white/40" dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleDateString()}</time>
                <p className="mt-1">“{row.text}”</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 space-y-4">
        {(episodes ?? []).map(episode => (
          <EpisodeCard
            key={episode.week}
            week={episode.week}
            title={episode.title}
            challengeLabel={scene(episode, 'The scores') ? 'Scores' : 'Challenge'}
            challengeLine={scene(episode, 'The scores') ?? scene(episode, 'The challenge') ?? 'Scores are in.'}
            tribalLine={scene(episode, 'Tribal Council') ?? 'Nobody went home this week.'}
            twistsLine={scene(episode, 'Twist')}
            recap={episode.scenes.filter(s => !['The scores', 'Tribal Council', 'Twist'].includes(s.label)).map(s => `${s.label}: ${s.text}`).join('\n') || undefined}
          />
        ))}
      </div>
    </div>
  )
}
