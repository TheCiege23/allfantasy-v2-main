'use client'
import { useEffect, useState } from 'react'
import styles from './SurvivorVoteRevealScrolls.module.css'
export type RevealScroll = {
  order: number; targetUserId: string | null; targetName: string | null;
  status: 'counts' | 'late_does_not_count' | 'forfeited_by_shot' | 'blocked_by_idol' | 'blocked_by_shot' | 'target_safe' | 'taken_by_vote_steal'; isExtraVote: boolean
}
/** Callers pass only the published sequence. */
export function SurvivorVoteRevealScrolls({ scrolls, eliminatedName, isTie, tiePhase, autoPlay = true, isPublished = true, exileEnabled = false }: {
  scrolls: RevealScroll[]; eliminatedName: string | null; isTie: boolean; tiePhase: string | null;
  autoPlay?: boolean; isPublished?: boolean; exileEnabled?: boolean
}) {
  const [open, setOpen] = useState(!autoPlay)
  const [shown, setShown] = useState(autoPlay ? 0 : scrolls.length)
  const [playing, setPlaying] = useState(autoPlay)
  const [reduced, setReduced] = useState(false)
  const sequenceKey = JSON.stringify(scrolls)
  useEffect(() => { const mq = window.matchMedia('(prefers-reduced-motion: reduce)'); setReduced(mq.matches); const change = () => setReduced(mq.matches); mq.addEventListener('change', change); return () => mq.removeEventListener('change', change) }, [])
  useEffect(() => { setOpen(!autoPlay); setShown(autoPlay ? 0 : scrolls.length); setPlaying(autoPlay) }, [sequenceKey, autoPlay])
  useEffect(() => {
    if (!open || !playing || reduced || shown >= scrolls.length) return
    const timer = setTimeout(() => setShown(n => Math.min(n + 1, scrolls.length)), 2500)
    return () => clearTimeout(timer)
  }, [open, playing, reduced, shown, scrolls.length])
  const counts = new Map<string, number>()
  for (const vote of scrolls.slice(0, shown)) if (vote.status === 'counts' && vote.targetName) counts.set(vote.targetName, (counts.get(vote.targetName) ?? 0) + 1)
  const finished = shown >= scrolls.length
  if (!open) return <div className="text-center">
    <img src="/survivor/exile/scroll-sealed.svg" alt="Sealed Torch Ceremony scroll" width={200} height={140} className={styles.sealed} />
    <p className="text-sm text-amber-100">The Torch Ceremony results are published.</p>
    <button type="button" onClick={() => { setOpen(true); if (reduced) setShown(scrolls.length) }} className="mt-3 min-h-11 rounded border border-amber-300/40 px-4 text-sm text-amber-100">Break the seal</button>
  </div>
  return <div className={styles.scroll}>
    <img src="/survivor/exile/scroll-roller.svg" alt="" width={640} height={36} className={styles.roller} />
    <div className={styles.paper}>
      <h4 className={styles.title}>Torch Ceremony</h4>
      <p className="mt-2 text-center text-xs">Elimination Council · Published results</p>
      <div aria-live="polite" aria-atomic="false">
        {scrolls.slice(0, shown).map((vote, i) => <div key={`${vote.order}-${i}`} className={`${styles.slip} ${vote.status !== 'counts' ? styles.invalid : ''}`}>
          <span className={styles.ordinal}>Vote {i + 1}{vote.isExtraVote ? ' · Extra vote' : ''}</span>
          <span className={styles.name}>{vote.targetName ?? 'Unnamed target'}</span>
          {vote.status !== 'counts' && <span className={styles.stamp}>{vote.status === 'taken_by_vote_steal' ? 'Taken · Does not count' : vote.status === 'blocked_by_idol' ? 'Idol · Does not count' : vote.status === 'blocked_by_shot' ? 'Shot succeeded · Does not count' : vote.status === 'forfeited_by_shot' ? 'Shot used · Ballot forfeited' : vote.status === 'late_does_not_count' ? 'Late · Does not count' : 'Safe · Does not count'}</span>}
        </div>)}
      </div>
      {counts.size > 0 && <div className={styles.tally}><p className={styles.ordinal}>Tally</p>{[...counts].sort((a,b) => b[1]-a[1]).map(([name,n]) => <p key={name} className="mt-2 flex justify-between gap-3 text-sm"><span>{name}</span><strong>{n}</strong></p>)}</div>}
      {finished && <div className={styles.verdict}>
        {isTie ? <p>A tie remains. {tiePhase === 'commissioner_tiebreak_required' ? 'Awaiting the configured tiebreak.' : 'Awaiting a revote.'}</p> : eliminatedName ? <><span className={styles.stamp}>Voted out</span><p className={`${styles.name} mt-3`}>{eliminatedName}</p>{exileEnabled && <p className="mt-3 text-sm">Heads to Exile Island.</p>}</> : <p>No manager was voted out.</p>}
        <img src="/survivor/exile/wax-seal-broken.svg" alt="" width={64} height={80} className="mx-auto mt-5" />
      </div>}
      {!finished && <p className="mt-4 text-center text-xs">Reading vote {shown} of {scrolls.length}…</p>}
    </div>
    <img src="/survivor/exile/scroll-roller.svg" alt="" width={640} height={36} className={styles.roller} />
    <div className={styles.controls}>
      {!finished && <><button type="button" onClick={() => setShown(n => Math.min(n+1,scrolls.length))}>Read next vote</button><button type="button" onClick={() => setPlaying(v => !v)}>{playing ? 'Pause' : 'Play'}</button><button type="button" onClick={() => setShown(scrolls.length)}>Show all votes</button></>}
      {finished && <button type="button" onClick={() => { setShown(0); setOpen(false); setPlaying(true) }}>Replay</button>}
    </div>
  </div>
}
export default SurvivorVoteRevealScrolls
