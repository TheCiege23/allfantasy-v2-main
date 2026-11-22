'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { WatchPageData } from '@/lib/survivor/spectator/watchPage'
import { watchPollMs, type WatchCouncil } from '@/lib/survivor/spectator/watchModel'
import { FanPredictionsCard } from './FanPredictionsCard'

type PublicWatch = Extract<WatchPageData, { state: 'public' }>

const STAMP: Record<string, string> = {
  blocked_by_idol: 'Idol played',
  target_safe: 'Idol played',
  late_does_not_count: 'Too late',
  forfeited_by_shot: 'Forfeited',
  blocked_by_shot: 'Blocked',
  taken_by_vote_steal: 'Vote stolen',
}

function easternLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isFinite(date.getTime())
    ? `${date.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' })} ET`
    : ''
}

function phaseLabel(data: PublicWatch): string {
  if (data.phase === 'complete') return 'Season complete'
  if (data.phase === 'pre_draft' || data.week <= 0) return 'Season starts soon'
  return `Week ${data.week} · ${data.merged ? 'After the merge' : 'Tribes'}`
}

/**
 * The public watch page, refreshed while it is open: every 2.5 seconds during a Tribal Council read
 * (the pace one ballot is released at), less often otherwise. Read-only and sign-in free.
 */
export function SurvivorWatchLive({ leagueId, initial }: { leagueId: string; initial: PublicWatch }) {
  const [data, setData] = useState<PublicWatch>(initial)
  // The poll reads the latest council from here, so its pace follows the read without restarting.
  const councilRef = useRef(initial.council)

  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    const tick = async () => {
      try {
        const res = await fetch(`/api/survivor/watch?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
        const next = (await res.json().catch(() => null)) as WatchPageData | null
        if (!stopped && res.ok && next?.state === 'public') {
          councilRef.current = next.council
          setData(next)
        }
      } catch {
        // Keep showing the last good read; the next tick tries again.
      }
      if (!stopped) timer = window.setTimeout(tick, watchPollMs(councilRef.current))
    }
    timer = window.setTimeout(tick, watchPollMs(councilRef.current))
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [leagueId])

  return <main className="svk" style={{ minHeight: '100vh' }} data-testid="watch-page">
    <header className="svm-top">
      <Link href="/" className="svm-brand" aria-label="AllFantasy home"><i aria-hidden>AF</i>AllFantasy</Link>
      <span className="svk-grow" />
      <Link href="/leagues/create" className="svk-btn svk-btn-gold">Start a league</Link>
    </header>
    <div className="svm-body">
      <section className="svk-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="svk-lbl">Watching · {data.sport} Survivor</span>
        <h1 className="svk-cinzel" style={{ margin: 0, fontSize: 30, lineHeight: 1.15, color: '#f1d58a', overflowWrap: 'anywhere' }}>{data.leagueName}</h1>
        <span className="svk-sub">{phaseLabel(data)} · {data.remaining} {data.remaining === 1 ? 'castaway' : 'castaways'} left</span>
      </section>

      <div className="svm-cols">
        <CouncilCard council={data.council} />
        <aside className="svm-aside">
          <FanPredictionsCard leagueId={leagueId} councilKey={`${data.council?.week ?? 0}:${data.council?.state ?? 'none'}`} />
          {data.tribes.map(tribe => <div key={tribe.name} className="svk-card2" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="watch-tribe">
            <div className="svk-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {tribe.crestUrl ? <img src={tribe.crestUrl} alt="" style={{ width: 34 }} /> : null}
              <span className="svk-cinzel svk-grow" style={{ fontWeight: 700, fontSize: 15, letterSpacing: '.08em', color: tribe.color ?? '#f1d58a' }}>{tribe.name}</span>
              {tribe.total != null && <span className="svk-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>{tribe.total.toFixed(1)} pts</span>}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tribe.castaways.map(c => <li key={c.name} className="svk-pill" style={{ minHeight: 28, opacity: c.out ? 0.55 : 1, textDecoration: c.out ? 'line-through' : 'none' }}>
                {c.name}{c.out && c.outWeek ? ` · Wk ${c.outWeek}` : ''}
              </li>)}
            </ul>
          </div>)}
          {data.jury.length > 0 && <div className="svk-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="watch-jury">
            <span className="svk-lbl">The jury</span>
            <span className="svk-sub">{data.jury.join(', ')}</span>
          </div>}
          <div className="svk-card svm-cta">
            <span className="svk-cinzel" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.2, color: '#f1d58a' }}>Play the next season</span>
            <span className="svk-sub">Tribes, hidden idols, Tribal Council votes and Exile Island, on top of your fantasy team. Free to start.</span>
            <Link href="/leagues/create" className="svk-btn svk-btn-gold" style={{ minHeight: 46 }}>Start a Survivor league</Link>
          </div>
        </aside>
      </div>

      {data.episodes.length > 0 && <section aria-labelledby="watch-ep-h" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="watch-episodes">
        <h2 id="watch-ep-h" className="svk-lbl" style={{ margin: 0 }}>Episodes</h2>
        {data.episodes.map(ep => <article key={ep.week} className="svk-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="svk-cinzel" style={{ fontWeight: 700, fontSize: 18, color: '#f3ead6' }}>Episode {ep.week}: {ep.title}</span>
          {ep.scenes.map(scene => <p key={scene.label} className="svk-sub" style={{ margin: 0 }}><b style={{ color: '#f1d58a' }}>{scene.label}:</b> {scene.text}</p>)}
        </article>)}
      </section>}
    </div>
  </main>
}

function CouncilCard({ council }: { council: WatchCouncil | null }) {
  if (!council) {
    return <section className="svk-card svm-scroll" data-testid="watch-council">
      <span className="svk-lbl">Tribal Council</span>
      <span className="svk-sub">No Tribal Council yet this season. Check back on vote night.</span>
    </section>
  }
  const where = council.tribeName ? `${council.tribeName} · ` : ''
  if (council.state === 'voting') {
    return <section className="svk-card svm-scroll" data-testid="watch-council" data-state="voting">
      <span className="svk-lbl">Tribal Council · {where}Week {council.week}</span>
      <span className="svk-cinzel" style={{ fontSize: 22, color: '#f1d58a' }}>Votes are being cast</span>
      <span className="svk-sub">Voting closes {easternLabel(council.voteDeadlineAt)}. The read happens here, live, one vote at a time.</span>
    </section>
  }
  if (council.state === 'waiting') {
    return <section className="svk-card svm-scroll" data-testid="watch-council" data-state="waiting">
      <span className="svk-lbl">Tribal Council · {where}Week {council.week}</span>
      <span className="svk-cinzel" style={{ fontSize: 22, color: '#f1d58a' }}>The votes are in</span>
      <span className="svk-sub">Stay on this page: the read starts soon.</span>
    </section>
  }
  return <section className="svk-card svm-scroll" aria-live="polite" data-testid="watch-council" data-state={council.state}>
    <span className="svk-lbl">{council.state === 'reading' ? 'Live · ' : ''}Tribal Council · {where}Week {council.week}</span>
    <div className="svm-paper">
      <span className="svm-paper-sub">{council.state === 'reading' ? `Reading the votes · ${council.visibleSteps} of ${council.totalSteps ?? '?'}` : 'The tribe has spoken'}</span>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {council.steps.map(step => <li key={step.order} className="svm-slip" data-x={step.status !== 'counts'}>
          <span className="svm-slip-ord">Vote {step.order}</span>
          <span className="svm-slip-hand">{step.targetName ?? 'A manager'}</span>
          {STAMP[step.status] && <span className="svm-stamp">{STAMP[step.status]}</span>}
        </li>)}
      </ol>
      {council.state === 'read' && (council.eliminatedName
        ? <span className="svm-verdict" data-testid="watch-verdict">{council.eliminatedName} · voted out</span>
        : council.isTie ? <span className="svm-verdict">Tie vote</span> : null)}
    </div>
    <span className="svk-faint" style={{ fontSize: 12 }}>Who cast each vote stays secret. Display names only.</span>
  </section>
}
