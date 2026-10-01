'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { haptic } from '@/lib/platform/haptics'
import type { StoryCard, WeeklyStory as WeeklyStoryData } from '@/lib/core-app/weeklyStoryModel'
import { askChimmyAboutCareer } from './CareerAskChimmy'
import '@/components/core-app/af-career-story.css'

/**
 * Weekly Career Story — last week across every league, one full-screen card at a time.
 *
 * Phone: full screen; tap the right half for next, the left for back, swipe either way, press and
 * hold to pause. Tablet and desktop: a 9:16 card centred over the page, arrow keys and Esc. Cards
 * advance on their own every few seconds unless the reader prefers reduced motion — then they wait.
 *
 * The cover's line is Chimmy's, fetched when the story opens (`/api/core/weekly-story`); until it
 * arrives, and whenever it is refused, the deterministic line stands in. The "seen" mark is a
 * per-browser convenience in localStorage — losing it only re-lights the ring.
 */

const CARD_MS = 6000
const seenKey = (id: string) => `af-weekly-story-seen:${id}`

function readSeen(id: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(id)) === '1'
  } catch {
    return false
  }
}
function markSeen(id: string) {
  try {
    window.localStorage.setItem(seenKey(id), '1')
  } catch {
    // Private mode or blocked storage: the ring simply stays lit.
  }
}

export function WeeklyStory({ story }: { story: WeeklyStoryData }) {
  const [open, setOpen] = useState(false)
  // Starts "unseen" on the server and the first client paint; corrected after mount, so hydration matches.
  const [seen, setSeen] = useState(false)
  useEffect(() => setSeen(readSeen(story.id)), [story.id])

  const cover = story.cards.find((c) => c.kind === 'cover')
  const record = cover && cover.kind === 'cover' ? recordText(cover.wins, cover.losses, cover.ties) : null

  return (
    <>
      <button
        type="button"
        className="af-cst-tile"
        data-seen={seen ? 'true' : 'false'}
        onClick={() => {
          haptic('light')
          setOpen(true)
          markSeen(story.id)
          setSeen(true)
        }}
        aria-label={`Open your week ${story.week} story`}
      >
        <span className="af-cst-ring" aria-hidden>
          <span className="af-cst-ring-in">
            <span className="af-cst-ring-wk">WK</span>
            <span className="af-cst-ring-n">{story.week}</span>
          </span>
        </span>
        <span className="af-cst-tile-text">
          <span className="af-cst-tile-t">Your week {story.week} story</span>
          <span className="af-cst-tile-s">
            {record ? `${record} · ` : ''}
            {story.cards.length} cards · with Chimmy
          </span>
        </span>
      </button>
      {open ? <StoryViewer story={story} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function StoryViewer({
  story,
  onClose,
  initialIndex = 0,
}: {
  story: WeeklyStoryData
  onClose: () => void
  /** Which card to open on — the tile always opens the cover; a deep link may name another. */
  initialIndex?: number
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), story.cards.length - 1))
  const [paused, setPaused] = useState(false)
  const [headline, setHeadline] = useState<{ text: string; source: string }>({ text: story.templateHeadline, source: 'template' })
  const [reducedMotion, setReducedMotion] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  const last = story.cards.length - 1

  const next = useCallback(() => setIndex((i) => (i >= last ? i : i + 1)), [last])
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Chimmy's line, once per open. A failure keeps the template — it is always true.
  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/core/weekly-story?id=${encodeURIComponent(story.id)}`, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { headline?: { text?: string; source?: string } } | null) => {
        if (body?.headline?.text) setHeadline({ text: body.headline.text, source: body.headline.source ?? 'template' })
      })
      .catch(() => undefined)
    return () => ctrl.abort()
  }, [story.id])

  useEffect(() => {
    try {
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch {
      setReducedMotion(false)
    }
    closeRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  // Auto-advance; never past the last card, never while held or under reduced motion.
  useEffect(() => {
    if (paused || reducedMotion || index >= last) return
    const t = window.setTimeout(next, CARD_MS)
    return () => window.clearTimeout(t)
  }, [index, paused, reducedMotion, last, next])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  const card = story.cards[index]

  return (
    <div className="af-cst-scrim" role="dialog" aria-modal="true" aria-label={`Week ${story.week} story`} onClick={onClose}>
      <div
        className="af-cst-frame"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
        onTouchStart={(e) => {
          const t = e.touches[0]
          touch.current = { x: t.clientX, y: t.clientY, t: Date.now() }
        }}
        onTouchEnd={(e) => {
          const start = touch.current
          touch.current = null
          if (!start) return
          const t = e.changedTouches[0]
          const dx = t.clientX - start.x
          const dy = t.clientY - start.y
          if (dy > 90 && Math.abs(dx) < 60) onClose() // swipe down closes
          else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)()
        }}
      >
        <div className="af-cst-bars" aria-hidden>
          {story.cards.map((c, i) => (
            <span key={c.key} className="af-cst-bar">
              <i
                data-state={
                  i < index ? 'done' : i === index ? (reducedMotion || index >= last ? 'full' : 'now') : 'todo'
                }
                data-run={i === index && !paused && !reducedMotion && index < last ? 'true' : 'false'}
                style={{ animationDuration: `${CARD_MS}ms` }}
              />
            </span>
          ))}
        </div>

        <div className="af-cst-top">
          <span className="af-cst-top-t">
            Week {story.week} · {story.season}
          </span>
          <button ref={closeRef} type="button" className="af-cst-close" onClick={onClose} aria-label="Close story">
            ×
          </button>
        </div>

        <div className="af-cst-card" data-kind={card.kind} aria-live="polite">
          <CardBody card={card} headline={headline} onClose={onClose} />
        </div>

        {/* Tap zones sit under the card's own controls; the next card's buttons stay clickable. */}
        {card.kind !== 'next' ? (
          <>
            <button type="button" className="af-cst-zone af-cst-zone--prev" onClick={prev} aria-label="Previous card" disabled={index === 0} />
            <button type="button" className="af-cst-zone af-cst-zone--next" onClick={next} aria-label="Next card" />
          </>
        ) : null}

        <div className="af-cst-foot">
          <span>
            {index + 1} / {story.cards.length}
          </span>
          {paused || reducedMotion ? <span>{reducedMotion ? 'Tap to continue' : 'Paused'}</span> : null}
        </div>
      </div>
    </div>
  )
}

function CardBody({
  card,
  headline,
  onClose,
}: {
  card: StoryCard
  headline: { text: string; source: string }
  onClose: () => void
}) {
  switch (card.kind) {
    case 'cover':
      return (
        <>
          <p className="af-cst-eyebrow">Your week {card.week}</p>
          <p className="af-cst-big af-num">{recordText(card.wins, card.losses, card.ties)}</p>
          <p className="af-cst-sub">
            across {card.leagues} {card.leagues === 1 ? 'league' : 'leagues'}
            {card.pending > 0 ? ` · ${card.pending} still being played` : ''}
          </p>
          <p className="af-cst-headline">
            <span className="af-cst-mark" aria-hidden>
              ✦
            </span>
            {headline.text}
          </p>
        </>
      )
    case 'result':
      return (
        <>
          <p className="af-cst-eyebrow">
            {card.leagueName}
            {card.platform ? <span className="af-cst-plat">{card.platform}</span> : null}
          </p>
          <p className="af-cst-verdict" data-won={card.won ? 'true' : 'false'}>
            {card.won ? 'Win' : card.pointsFor === card.pointsAgainst ? 'Tie' : 'Loss'}
          </p>
          <p className="af-cst-score af-num">
            {card.pointsFor} <span>–</span> {card.pointsAgainst}
          </p>
          <p className="af-cst-sub">{card.won ? `by ${card.margin}` : card.pointsFor === card.pointsAgainst ? 'dead level' : `by ${card.margin}`}</p>
          <Link className="af-cst-link" href={`/core/matchup?league=${encodeURIComponent(card.leagueId)}`}>
            This week’s matchup →
          </Link>
        </>
      )
    case 'more':
      return (
        <>
          <p className="af-cst-eyebrow">And the rest</p>
          <p className="af-cst-big af-num">{card.count}</p>
          <p className="af-cst-sub">
            more {card.count === 1 ? 'result' : 'results'} · {card.wins} won, {card.losses} lost
          </p>
          <Link className="af-cst-link" href="/core/week?all=1">
            Every result →
          </Link>
        </>
      )
    case 'top-scorer':
      return (
        <>
          <p className="af-cst-eyebrow">Your top starter</p>
          <p className="af-cst-name">{card.name}</p>
          <p className="af-cst-score af-num">{card.points} pts</p>
          <p className="af-cst-sub">in {card.leagueName}</p>
        </>
      )
    case 'upset':
      return (
        <>
          <p className="af-cst-eyebrow">Upset · {card.leagueName}</p>
          <p className="af-cst-big af-num">{card.winChance}</p>
          <p className="af-cst-sub">your chance before kickoff — and you won</p>
          <p className="af-cst-score af-num">
            {card.pointsFor} <span>–</span> {card.pointsAgainst}
          </p>
        </>
      )
    case 'award':
      return (
        <>
          <p className="af-cst-eyebrow">Weekly award · {card.leagueName}</p>
          <p className="af-cst-name">{card.label}</p>
          <p className="af-cst-score af-num">
            {card.value} {card.unit === 'pts' ? 'pts' : 'margin'}
          </p>
        </>
      )
    case 'next':
      return (
        <>
          <p className="af-cst-eyebrow">This week</p>
          <p className="af-cst-name">Make it count</p>
          <div className="af-cst-actions">
            {card.actions.map((a) => (
              <Link key={a.href} className="af-cst-action" href={a.href}>
                {a.label}
              </Link>
            ))}
            <button type="button" className="af-cst-action af-cst-action--chimmy" onClick={() => {
                // Close first: the Chimmy drawer would otherwise open beneath a full-screen story.
                onClose()
                askChimmyAboutCareer(card.ask)
              }}>
              ✦ Ask Chimmy about last week
            </button>
          </div>
        </>
      )
  }
}

function recordText(w: number, l: number, t: number): string {
  return `${w}-${l}${t ? `-${t}` : ''}`
}
