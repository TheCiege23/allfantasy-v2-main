'use client'

import { useEffect, useRef, useState } from 'react'
import { SpecialtyReplayButton, SpecialtyTag, spStyles } from '@/components/league/specialty/SpecialtyShell'
import type { DevyStashItem } from '@/lib/devy/devyHomeView'
import d from './devy-specialty.module.css'

/*
 * Promotion day (handoff devy/DevyPromotion, the signature moment): the card flips (0.9s, 3D) from the
 * college jersey to the pro jersey and you pick where he goes. Promote calls the existing promotion
 * route (POST /api/leagues/[id]/devy/promotion, addToRoster: true) — only when the rights are
 * PROMOTION_ELIGIBLE and the pro player is mapped, exactly what that route requires. Otherwise the
 * screen is a preview and says so.
 *
 * Taxi squad is shown but disabled: the promotion engine (`executePromotion`) can add the player to the
 * active roster or leave him off it, but has no "promote onto the taxi squad" path.
 */

function Jersey({ color, stripe, number }: { color: string; stripe: string; number: string }) {
  return (
    <svg className={d.jersey} viewBox="0 0 120 120" aria-hidden>
      <path d="M38 14 L22 22 L8 46 L26 56 L32 46 L32 108 L88 108 L88 46 L94 56 L112 46 L98 22 L82 14 C78 22 70 26 60 26 C50 26 42 22 38 14 Z" fill={color} stroke="#07080d" strokeWidth="4" strokeLinejoin="round" />
      <rect x="32" y="60" width="56" height="5" fill={stripe} />
      <rect x="32" y="69" width="56" height="5" fill={stripe} />
      <text x="60" y="100" textAnchor="middle" fontFamily="Georgia, serif" fontSize="26" fill="#fff">
        {number}
      </text>
    </svg>
  )
}

export function DevyPromotionMoment({
  leagueId,
  item,
  devySlots,
  proRoster,
  onBack,
  onPromoted,
}: {
  leagueId: string
  item: DevyStashItem
  devySlots: { used: number; total: number }
  proRoster: { used: number; total: number | null }
  onBack: () => void
  onPromoted: () => void
}) {
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timers = useRef<number[]>([])
  const canPromote = item.promotionEligible && !!item.promotedProPlayerId

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  /** Replay (QA): flip to the pro side; before promotion, flip back so the decision still reads true. */
  const replay = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    setFlipped(false)
    timers.current = [window.setTimeout(() => setFlipped(true), 60)]
    if (!done) timers.current.push(window.setTimeout(() => setFlipped(false), 1900))
  }

  const promote = async () => {
    if (!canPromote || !item.promotedProPlayerId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/devy/promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rightsId: item.rightsId, promotedProPlayerId: item.promotedProPlayerId, addToRoster: true }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Promotion failed')
        return
      }
      setDone(true)
      setFlipped(true)
      onPromoted()
    } catch {
      setError('Promotion failed')
    } finally {
      setBusy(false)
    }
  }

  const proUsed = proRoster.used + (done ? 1 : 0)
  const devyUsed = Math.max(0, devySlots.used - (done ? 1 : 0))
  const subtitle = [item.position, item.school, item.classLabel].filter(Boolean).join(' · ')

  return (
    <div className={spStyles.page} style={{ padding: 0 }} data-testid="devy-promotion-moment">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button type="button" className={spStyles.btn} onClick={onBack} aria-label="Back to the devy home" style={{ width: 44, padding: 0 }}>
          ‹
        </button>
        <div style={{ minWidth: 0 }}>
          <h2 className={spStyles.h1}>Promotion day</h2>
          <p className={spStyles.t2} style={{ margin: 0 }}>
            {canPromote ? 'He is eligible — promote him to your pro roster.' : 'Preview — promotion opens once he is drafted and eligible.'}
          </p>
        </div>
      </div>

      <div className={d.moment}>
        <div className={`${d.flip} ${flipped ? d.flipOn : ''}`}>
          <div className={d.flipIn}>
            <div className={`${d.face} ${d.front}`} aria-hidden={flipped}>
              <span className={spStyles.lbl} style={{ color: 'var(--acc2)' }}>
                Devy stash · college
              </span>
              <Jersey color="#c4561a" stripe="#fde7d2" number={item.position} />
              <strong>{item.name}</strong>
              <span>{subtitle}</span>
              {item.declared ? <SpecialtyTag tone="zone">Declared</SpecialtyTag> : null}
            </div>
            <div className={`${d.face} ${d.back}`} aria-hidden={!flipped}>
              <span className={spStyles.lbl} style={{ color: '#9fc4ff' }}>
                Pro roster
              </span>
              <Jersey color="#2a4a8a" stripe="#d6e4ff" number={item.position} />
              <strong>{item.name}</strong>
              <span>{item.position} · now scores</span>
              <SpecialtyTag tone="safe">Promoted</SpecialtyTag>
            </div>
          </div>
        </div>

        <div className={d.decide}>
          <h2>{done ? `${item.name} is a pro` : `Promote ${item.name}?`}</h2>
          <p className={spStyles.t2} style={{ margin: 0, fontSize: 15 }}>
            {done
              ? 'He is on your pro roster and scores from now on. His devy slot is free for next year’s devy draft.'
              : 'Promoting frees a devy slot for next year’s devy draft. Devy players don’t score until they are promoted.'}
          </p>
          <div className={`${spStyles.card2} ${spStyles.pad}`}>
            <span className={spStyles.lbl}>Where he goes</span>
            <div className={d.dest} role="group" aria-label="Destination">
              <button type="button" className={d.destBtn} aria-pressed="true">
                Pro roster
                <span>
                  Scores now · {proUsed}
                  {proRoster.total ? `/${proRoster.total}` : ''}
                </span>
              </button>
              <button type="button" className={d.destBtn} aria-pressed="false" disabled title="The promotion engine has no taxi-squad path yet">
                Taxi squad
                <span>Not available yet</span>
              </button>
            </div>
            <div className={d.counters}>
              <span>
                Devy slots{' '}
                <b>
                  {devyUsed}/{devySlots.total}
                </b>
              </span>
              <span>
                Pro roster{' '}
                <b>
                  {proUsed}
                  {proRoster.total ? `/${proRoster.total}` : ''}
                </b>
              </span>
            </div>
          </div>
          {error ? (
            <p role="alert" style={{ margin: 0, color: '#ff9a8a' }}>
              {error}
            </p>
          ) : null}
          <div className={spStyles.actions}>
            {!done ? (
              <button type="button" className={`${spStyles.btn} ${spStyles.btnP}`} onClick={promote} disabled={!canPromote || busy} data-testid="devy-promote">
                {busy ? 'Promoting…' : canPromote ? 'Promote him' : 'Not eligible yet'}
              </button>
            ) : null}
            <SpecialtyReplayButton onReplay={replay} />
          </div>
        </div>
      </div>
    </div>
  )
}
