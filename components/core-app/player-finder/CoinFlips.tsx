'use client'

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { CoinFlip } from '@/lib/core-app/playerFun'
import { playerFunCopy } from '@/lib/core-app/playerFunCopy'

/**
 * "Coin flips" (Guap, 2026-10-08, item #5): the leagues where starting him — or sitting him — is
 * within a few points either way (playerFun.coinFlipsOf), as a quick game. You pick who you would
 * start — tap a side, or swipe the card toward it — and then we show our lean and the button to set
 * that lineup on the platform.
 *
 * ⚠ YOUR PICK IS NEVER SAVED AND NEVER SENT ANYWHERE. It only decides what the card reveals; AllFantasy
 * is read-only, and the lineup button opens the platform's own (verified) lineup screen.
 *
 * Swipe: a horizontal drag past SWIPE_PX picks that side — left is him, right is the other name. A
 * vertical drag scrolls the page as usual (`touch-action: pan-y`).
 */

export const SWIPE_PX = 70

export type FlipLink = { href: string; external: boolean; platformLabel: string }

function FlipCard({ flip, link }: { flip: CoinFlip; link: FlipLink | null }) {
  const { language } = useOptionalLanguage()
  const t = playerFunCopy(language)
  const [pick, setPick] = useState<'a' | 'b' | null>(null)
  const [dx, setDx] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0] || n

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pick) return
    start.current = { x: e.clientX, y: e.clientY }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const x = e.clientX - start.current.x
    const y = e.clientY - start.current.y
    if (Math.abs(x) > Math.abs(y)) setDx(Math.max(-120, Math.min(120, x)))
  }
  const onUp = () => {
    if (!start.current) return
    start.current = null
    if (dx <= -SWIPE_PX) setPick('a')
    else if (dx >= SWIPE_PX) setPick('b')
    setDx(0)
  }

  const leanName = flip.lean === 'a' ? flip.a.name : flip.b.name
  const side = (s: 'a' | 'b') => {
    const p = s === 'a' ? flip.a : flip.b
    const starting = s === 'a' ? flip.aStarting : !flip.aStarting
    return (
      <button
        type="button"
        className="af-pf-flip-side"
        data-side={s}
        data-picked={pick === s ? 'true' : pick ? 'false' : undefined}
        data-lean={pick && flip.lean === s ? 'true' : undefined}
        aria-pressed={pick === s}
        disabled={pick !== null}
        onClick={() => setPick(s)}
      >
        <span className="af-pf-flip-name">{p.name}</span>
        <span className="af-pf-flip-pts af-num">{p.points.toFixed(1)}</span>
        <span className="af-pf-flip-role">{starting ? t.flipStarting : t.flipBench}</span>
      </button>
    )
  }

  return (
    <li className="af-pf-flip" data-picked={pick ? 'true' : 'false'}>
      <span className="af-pf-flip-league">{t.flipIn(flip.leagueName)}</span>
      <div
        className="af-pf-flip-pair"
        style={dx ? { transform: `translateX(${dx}px) rotate(${dx / 30}deg)` } : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {side('a')}
        <span className="af-pf-flip-vs" aria-hidden>
          vs
        </span>
        {side('b')}
      </div>
      {pick ? (
        <div className="af-pf-flip-reveal" role="status">
          <strong>{flip.margin === 0 ? t.flipEven : pick === flip.lean ? t.flipAgree : t.flipDisagree}</strong>{' '}
          {flip.margin === 0 ? null : t.flipLean(last(leanName), flip.margin.toFixed(1))}
          <span className="af-pf-flip-actions">
            {link ? (
              link.external ? (
                <a className="af-btn af-pf-flip-go" href={link.href} target="_blank" rel="noopener noreferrer">
                  {t.flipSetLineup(link.platformLabel)}
                </a>
              ) : (
                <Link className="af-btn af-pf-flip-go" href={link.href}>
                  {t.flipSetLineup(link.platformLabel)}
                </Link>
              )
            ) : null}
            <button type="button" className="af-pf-flip-again" onClick={() => setPick(null)}>
              {t.flipAgain}
            </button>
          </span>
        </div>
      ) : null}
    </li>
  )
}

export function CoinFlips({ flips, linkFor }: { flips: CoinFlip[]; linkFor: (leagueId: string) => FlipLink | null }) {
  const { language } = useOptionalLanguage()
  if (flips.length === 0) return null
  const t = playerFunCopy(language)
  return (
    <section className="af-pf-flips" aria-labelledby="af-pf-flips-h">
      <header className="af-pf-flips-head">
        <h3 className="af-label" id="af-pf-flips-h">
          🪙 {t.flipsTitle}
        </h3>
        <p className="af-pf-flips-sub">{t.flipsSub}</p>
      </header>
      <ul className="af-pf-flip-list">
        {flips.map((f) => (
          <FlipCard key={f.leagueId} flip={f} link={linkFor(f.leagueId)} />
        ))}
      </ul>
    </section>
  )
}

export default CoinFlips
