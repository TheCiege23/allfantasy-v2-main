'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { SurvivorAvatar } from './SurvivorAvatar'
import './survivor-weekly.css'

export type TorchOutMomentView = {
  key: string
  councilId: string
  week: number
  userId: string
  rosterId: string | null
  name: string
  isYou: boolean
  exileEnabled: boolean
  seen: boolean
}

export type ImmunityMomentView = {
  key: string
  week: number
  tribeId: string
  tribeName: string | null
  userId: string
  rosterId: string
  name: string
  score: number
  isYou: boolean
  seen: boolean
}

export type WeeklyMomentsView = { torchOut: TorchOutMomentView | null; immunity: ImmunityMomentView[] }

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

function stripTribeIcon(name: string | null): string | null {
  if (!name) return null
  return name.replace(/^[^\p{L}\p{N}]+/u, '').trim() || name
}

export function markMomentSeen(leagueId: string, key: string): Promise<void> {
  return fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  }).then(() => undefined, () => undefined)
}

/** The immunity win moment: swaying necklace, "{Manager} wins immunity", score and what it means. */
export function SurvivorImmunityWin({ moment, compact = false }: { moment: ImmunityMomentView; compact?: boolean }) {
  const tribe = moment.tribeId === 'merge' ? null : stripTribeIcon(moment.tribeName)
  const scope = tribe ? `Tribe ${tribe}` : 'the merged tribe'
  return <section className="swl-moment swl-moment-immunity" data-compact={compact} data-testid="survivor-immunity-win" aria-label="Immunity">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="swl-neck" src="/survivor/weekly/immunity-necklace.svg" alt="Immunity necklace" />
    <div className="swl-moment-copy">
      <span className="swl-lbl swl-gold">Immunity · Week {moment.week}{tribe ? ` · Tribe ${tribe}` : ''}</span>
      <h2 className="swl-moment-title">{moment.isYou ? 'You win immunity' : `${moment.name} wins immunity`}</h2>
      <p className="swl-t2" style={{ fontSize: 14 }}>Top score in {scope} with {moment.score.toFixed(1)} points. Safe at Tribal Council and can’t receive votes this week.</p>
      {!compact && <div className="swl-chips">
        <span className="swl-chip swl-chip-gold">Won by top tribe score</span>
        <span className="swl-chip">Worn until the next lock</span>
      </div>}
    </div>
  </section>
}

/**
 * Torch-out: plays once after the verdict. The flame shrinks and fades (1.4s), smoke rises, then the
 * manager's avatar fades to grey. Reduced motion swaps to the snuffed torch at once.
 */
export function SurvivorTorchOut({
  moment,
  exileHref,
  onDone,
  onDismiss,
}: {
  moment: TorchOutMomentView
  exileHref?: string
  onDone?: () => void
  onDismiss?: () => void
}) {
  const [state, setState] = useState<'idle' | 'playing' | 'done'>('idle')
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    if (prefersReducedMotion()) {
      setState('done')
      doneRef.current?.()
      return
    }
    const start = window.setTimeout(() => setState('playing'), 300)
    const finish = window.setTimeout(() => { setState('done'); doneRef.current?.() }, 300 + 3000)
    return () => { window.clearTimeout(start); window.clearTimeout(finish) }
  }, [moment.key])
  const stageClass = state === 'playing' ? ' is-playing' : state === 'done' ? ' is-done' : ''
  return <section className="swl-moment swl-moment-torch" data-testid="survivor-torch-out" aria-label="Torch-out" aria-live="polite">
    <div className={`swl-stage${stageClass}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="swl-smoke" src="/survivor/weekly/torch-out.svg" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="swl-lit" src="/survivor/weekly/torch-lit.svg" alt="" />
    </div>
    <div className="swl-moment-copy">
      <span className="swl-lbl" style={{ color: '#ff9a3c' }}>Torch-out · Week {moment.week}</span>
      <h2 className="swl-moment-title">{moment.name}, your torch is out</h2>
      <div className={`swl-torch-av${stageClass}`}>
        <SurvivorAvatar name={moment.name} status={state === 'done' ? 'out' : 'active'} size={48} ringColor="#4a4f5c" gapColor="#0b0d14" />
        <p className="swl-t2" style={{ fontSize: 14 }}>
          {moment.isYou ? 'The vote is final and your time on the island is over' : `The vote is final and ${moment.name} leaves the island`}
          {moment.exileEnabled ? `. ${moment.isYou ? 'You head' : 'They head'} to Exile Island to play for a way back.` : '.'}
        </p>
      </div>
      <div className="swl-moment-actions">
        {moment.exileEnabled && exileHref && <Link className="swl-btn swl-btn-gold" href={exileHref} data-testid="survivor-torch-exile">{moment.isYou ? 'Go to Exile Island' : 'See Exile Island'}</Link>}
        {onDismiss && <button type="button" className="swl-btn" onClick={onDismiss}>Close</button>}
      </div>
    </div>
  </section>
}

/**
 * Weekly moments strip for the Survivor home and Tribal page: the torch-out after a read (once per
 * user, seen state saved server-side) and any immunity necklace still being worn.
 */
export function SurvivorWeeklyMoments({ leagueId, exileHref, showImmunity = true }: { leagueId: string; exileHref?: string; showImmunity?: boolean }) {
  const [moments, setMoments] = useState<WeeklyMomentsView | null>(null)
  const [hideTorch, setHideTorch] = useState(false)
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/moments`, { cache: 'no-store' })
      if (!response.ok) return
      setMoments(await response.json())
    } catch {
      /* moments are decoration; the rest of the page stands without them */
    }
  }, [leagueId])
  useEffect(() => { void load() }, [load])

  const torch = moments?.torchOut && !moments.torchOut.seen && !hideTorch ? moments.torchOut : null
  const necklaces = useMemo(() => (showImmunity ? moments?.immunity ?? [] : []), [showImmunity, moments?.immunity])
  const posted = useRef(new Set<string>())
  useEffect(() => {
    for (const necklace of necklaces) {
      if (necklace.seen || posted.current.has(necklace.key)) continue
      posted.current.add(necklace.key)
      void markMomentSeen(leagueId, necklace.key)
    }
  }, [leagueId, necklaces])
  if (!torch && !necklaces.length) return null
  return <div className="swl-moments" data-testid="survivor-weekly-moments">
    {torch && <SurvivorTorchOut
      moment={torch}
      exileHref={exileHref}
      onDone={() => void markMomentSeen(leagueId, torch.key)}
      onDismiss={() => setHideTorch(true)}
    />}
    {necklaces.slice(0, 2).map(necklace => <SurvivorImmunityWin key={necklace.key} moment={necklace} compact={necklace.seen} />)}
  </div>
}
