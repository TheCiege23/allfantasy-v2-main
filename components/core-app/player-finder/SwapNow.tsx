'use client'

import { useState } from 'react'

import type { ChimmyActionCard } from '@/lib/chimmy/actions/types'

/**
 * "Swap now" — make a start/bench swap in an AllFantasy league without leaving the finder (Phase 3).
 *
 * TWO TAPS, ON PURPOSE. The first asks the server for a confirm card (POST
 * /api/core/players/lineup-swap): every check runs there — your roster, the league's lock, his game
 * not started, the slot he can actually fill — and the card says exactly what will move. NOTHING
 * CHANGES until the second tap, which sends only the card's signed token to the same confirm route
 * Chimmy's cards use; that route re-checks everything and can run a card once.
 *
 * Only rendered for AllFantasy's own leagues. Sleeper, ESPN and Yahoo lineups are changed on those
 * platforms — the finder's "Open lineup" buttons go there.
 */

type Phase =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'card'; card: ChimmyActionCard }
  | { kind: 'saving'; card: ChimmyActionCard }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

export function SwapNow({
  leagueId,
  startId,
  benchId,
  label = 'Swap now',
}: {
  leagueId: string
  /** Who comes into the lineup. */
  startId: string
  /** Who goes to the bench. */
  benchId: string
  label?: string
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const ask = async () => {
    setPhase({ kind: 'asking' })
    try {
      const res = await fetch('/api/core/players/lineup-swap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leagueId, startIds: [startId], benchIds: [benchId] }),
      })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; card?: ChimmyActionCard; message?: string } | null
      if (body?.ok && body.card) setPhase({ kind: 'card', card: body.card })
      else setPhase({ kind: 'error', message: body?.message ?? 'That swap could not be prepared.' })
    } catch {
      setPhase({ kind: 'error', message: 'That swap could not be prepared. Nothing was changed.' })
    }
  }

  const confirm = async (card: ChimmyActionCard) => {
    setPhase({ kind: 'saving', card })
    try {
      const res = await fetch('/api/chimmy/actions/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: card.token }),
      })
      const body = (await res.json().catch(() => null)) as { ok?: boolean; status?: string; message?: string } | null
      if (body?.ok || body?.status === 'executed' || body?.status === 'already_executed') {
        setPhase({ kind: 'done', message: body?.message ?? 'Lineup saved.' })
      } else {
        setPhase({ kind: 'error', message: body?.message ?? 'The swap was not saved. Nothing was changed.' })
      }
    } catch {
      setPhase({ kind: 'error', message: 'The swap was not saved. Nothing was changed.' })
    }
  }

  if (phase.kind === 'idle' || phase.kind === 'asking') {
    return (
      <button type="button" className="af-pf-swapnow-btn" onClick={ask} disabled={phase.kind === 'asking'} aria-busy={phase.kind === 'asking'}>
        {phase.kind === 'asking' ? 'Checking…' : label}
      </button>
    )
  }

  if (phase.kind === 'card' || phase.kind === 'saving') {
    const { card } = phase
    const moveIn = card.lineup?.moveIn ?? []
    const moveOut = card.lineup?.moveOut ?? []
    return (
      <div className="af-pf-swapnow-card" role="group" aria-label={card.title}>
        <p className="af-pf-swapnow-title">{card.title}{card.league.name ? ` · ${card.league.name}` : ''}</p>
        <ul className="af-pf-swapnow-moves">
          {moveIn.map((p) => (
            <li key={`in-${p.name}`} data-move="in">
              Start <strong>{p.name}</strong>
              {p.slot ? ` at ${p.slot}` : ''}
            </li>
          ))}
          {moveOut.map((p) => (
            <li key={`out-${p.name}`} data-move="out">
              Bench <strong>{p.name}</strong>
            </li>
          ))}
        </ul>
        {card.warnings.length > 0 ? (
          <ul className="af-pf-swapnow-warnings">
            {card.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        <div className="af-pf-swapnow-actions">
          <button type="button" className="af-pf-swapnow-confirm" onClick={() => confirm(card)} disabled={phase.kind === 'saving'}>
            {phase.kind === 'saving' ? 'Saving…' : 'Confirm'}
          </button>
          <button type="button" className="af-pf-swapnow-cancel" onClick={() => setPhase({ kind: 'idle' })} disabled={phase.kind === 'saving'}>
            Cancel
          </button>
        </div>
        <p className="af-pf-swapnow-note">Nothing changes until you confirm. This card expires in 10 minutes.</p>
      </div>
    )
  }

  return (
    <p className="af-pf-swapnow-result" data-kind={phase.kind} role="status">
      {phase.message}
      {phase.kind === 'error' ? (
        <button type="button" className="af-pf-swapnow-retry" onClick={() => setPhase({ kind: 'idle' })}>
          Try again
        </button>
      ) : null}
    </p>
  )
}

export default SwapNow
