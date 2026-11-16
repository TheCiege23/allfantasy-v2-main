'use client'

import React, { useEffect, useState } from 'react'
import ChimmyActionCard from './ChimmyActionCard'
import { subscribeChimmyActionCards, type ChimmyActionCard as Card } from '@/lib/chimmy-chat/actionCards'

/**
 * The confirm cards a Chimmy answer prepared, for a chat surface built on `ChimmyChatShell`.
 *
 * 🛑 THESE SURFACES NEVER SHOWED A CARD (found 2026-11-16). `ChimmyChatService` publishes an answer's
 * cards to an in-page store (`lib/chimmy-chat/actionCards.ts`) so "any surface can render them without
 * the chat shell having to know" — but nothing subscribed, so only the /core drawer, which reads cards
 * itself, ever rendered one. In the draft room, a queue card would have been made, signed and invisible.
 *
 * Scoped to one league when given, so a card for another league never appears beside this one.
 */
export default function ChimmyActionCardTray({ leagueId }: { leagueId?: string | null }) {
  const [cards, setCards] = useState<Card[]>([])
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => subscribeChimmyActionCards((next) => setCards(next)), [])

  const shown = cards.filter((c) => !dismissed.has(c.actionId) && (!leagueId || c.league.id === leagueId))
  if (shown.length === 0) return null
  return (
    <div className="mt-2 space-y-2" data-testid="chimmy-action-card-tray">
      {shown.map((card) => (
        <ChimmyActionCard
          key={card.actionId}
          card={card}
          onDismiss={(id) => setDismissed((prev) => new Set([...prev, id]))}
        />
      ))}
    </div>
  )
}
