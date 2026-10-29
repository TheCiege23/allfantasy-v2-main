'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { survivorBackgroundSrc } from '@/lib/survivor/survivorMood'
import type { LeagueRecord, SeasonTimelineNode, TrophyRecord } from '@/lib/survivor/seasonStory'
import { SvkEmpty, SvkSkeleton } from './core/SurvivorKit'
import './survivor-core.css'

type View = {
  leagueName: string
  sport: string
  season: number
  seasons: number[]
  nodes: SeasonTimelineNode[]
  trophies: TrophyRecord[]
  records: LeagueRecord[]
}

/** Season story and trophy case (survivor-core handoff §3, SeasonTimeline). */
export function SurvivorSeasonStory({ leagueId, backHref }: { leagueId: string; backHref: string }) {
  const [season, setSeason] = useState<number | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async (year: number | null) => {
    setError(false)
    try {
      const qs = year ? `?season=${year}` : ''
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/season-story${qs}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const next = (await res.json()) as View
      setView(next)
      // Open on the latest week that has a story to tell.
      const withCard = next.nodes.filter(node => node.card)
      setSelected(withCard.length ? withCard[withCard.length - 1].key : null)
    } catch {
      setError(true)
    }
  }, [leagueId])

  useEffect(() => { void load(season) }, [load, season])

  const node = useMemo(() => view?.nodes.find(n => n.key === selected) ?? null, [view, selected])

  return <div className="svk" data-testid="survivor-season-story">
    <header className="svk-head">
      <Link href={backHref} className="svk-btn svk-btn-icon" aria-label="Back to the island"><ChevronLeft size={18} aria-hidden /></Link>
      <div className="svk-grow">
        <h1>Season story</h1>
        <p className="svk-head-sub">{view ? `${view.leagueName} · every week of the ${view.season} season, plus the league's history` : 'Every week of the season, plus the league’s history'}</p>
      </div>
      {view && view.seasons.length > 1 && <div className="svs-years" role="group" aria-label="Season">
        {view.seasons.map(year => <button key={year} type="button" aria-pressed={year === view.season} onClick={() => setSeason(year)}>{year}</button>)}
      </div>}
    </header>

    <div className="svk-page">
      {error && <div className="svk-card" style={{ marginTop: 24 }}>
        <SvkEmpty icon="/survivor/exile/scroll-sealed.svg" title="The season story didn't load" body="Check your connection and try again.">
          <button type="button" className="svk-btn" onClick={() => void load(season)}>Try again</button>
        </SvkEmpty>
      </div>}

      {!view && !error && <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 }} role="status" aria-label="Loading the season story">
        <SvkSkeleton height={80} />
        <SvkSkeleton height={340} radius={16} />
      </div>}

      {view && <>
        <nav className="svk-tl" aria-label="Season timeline" style={{ marginTop: 24 }} data-testid="survivor-season-timeline">
          {view.nodes.map(n => <button key={n.key} type="button" className="svk-tl-w" data-kind={n.kind} aria-pressed={n.key === selected} disabled={!n.card} onClick={() => setSelected(n.key)} data-testid="survivor-timeline-node">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="svk-tl-dot"><img src={n.icon} alt="" /></span>
            <b>{n.week === 0 ? 'Draft' : `Wk ${n.week}`}</b>
            <span>{n.label}</span>
          </button>)}
        </nav>

        {node?.card
          ? <section key={node.key} className="svk-hero svk-fade" style={{ marginTop: 20 }} data-testid="survivor-season-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="svk-hero-bg" src={survivorBackgroundSrc(node.card.mood, view.sport)} alt="" />
            <div className="svk-hero-veil" aria-hidden />
            <div className="svk-hero-in">
              <div className="svk-hero-copy">
                <span className="svk-hero-kicker">{node.card.kicker}</span>
                <h2>{node.card.headline}</h2>
                <p className="svk-hero-sub">{node.card.sub}</p>
                {node.card.chips.length > 0 && <div className="svk-chips">{node.card.chips.map(chip => <span key={chip} className="svk-pill">{chip}</span>)}</div>}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="svk-hero-art" src={node.card.heroPath} alt="" />
            </div>
          </section>
          : <div className="svk-card" style={{ marginTop: 20 }}>
            <SvkEmpty icon="/survivor/weekly/torch-lit-icon.svg" title="The story starts at the draft" body="Each week's biggest moment lands here once it has been revealed to the league." />
          </div>}

        <div className="svs-lower">
          <section aria-labelledby="svs-trophies">
            <h2 id="svs-trophies" className="svk-lbl" style={{ margin: '0 0 12px' }}>Trophy case</h2>
            {view.trophies.length
              ? <div className="svs-shelf">{view.trophies.map(t => <div key={t.season} className="svk-card svs-trophy" data-testid="survivor-trophy">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div className="svs-trophy-art"><img src="/survivor/late/champion-trophy.svg" alt="" /></div>
                <div className="svs-trophy-c">
                  <span className="svk-lbl">{t.season}{t.sport ? ` · ${t.sport}` : ''}</span>
                  <span className="svs-trophy-name">{t.championName}</span>
                  {t.line && <span className="svk-sub" style={{ fontSize: 14 }}>{t.line}</span>}
                </div>
              </div>)}</div>
              : <div className="svk-card"><SvkEmpty icon="/survivor/late/champion-icon.svg" iconStyle={{ filter: 'grayscale(1) brightness(.7)' }} title="No champions yet" body="When the jury crowns a winner, their trophy goes on this shelf." /></div>}
          </section>
          <section aria-labelledby="svs-records">
            <h2 id="svs-records" className="svk-lbl" style={{ margin: '0 0 12px' }}>League records</h2>
            <div className="svk-card svs-records">
              {view.records.length
                ? view.records.map(r => <div key={r.key} className="svs-rec" data-testid="survivor-record">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.icon} alt="" />
                  <div className="svk-grow"><b>{r.title}</b><span className="svk-faint" style={{ fontSize: 13 }}>{r.holder}</span></div>
                  <span className="svk-num" style={{ fontSize: 16 }}>{r.value}</span>
                </div>)
                : <p className="svk-sub" style={{ padding: '18px 0', fontSize: 14 }}>Records appear once the first immunity wins, torches and jury votes are in.</p>}
            </div>
          </section>
        </div>
      </>}
    </div>
  </div>
}
