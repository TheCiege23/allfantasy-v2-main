'use client'

import React, { useEffect, useState } from 'react'
import ChimmyActionCard from './ChimmyActionCard'
import {
  dismissChimmyActionCard,
  subscribeChimmyActionCards,
  type ChimmyActionCard as Card,
} from '@/lib/chimmy-chat/actionCards'

/**
 * The confirm cards Chimmy has prepared in this page, newest first.
 *
 * Fed by the in-page store that `sendChimmyMessage` publishes to, so any chat surface can mount it
 * next to its conversation without the shell learning a new message field. Renders nothing when
 * there are no cards.
 */
export default function ChimmyActionCardTray({ className = '' }: { className?: string }) {
  const [cards, setCards] = useState<Card[]>([])
  useEffect(() => subscribeChimmyActionCards(setCards), [])
  if (cards.length === 0) return null
  return (
    <section aria-label="Moves Chimmy prepared" className={`space-y-3 ${className}`} data-testid="chimmy-action-tray">
      {cards.map((card) => (
        <ChimmyActionCard key={card.actionId} card={card} onDismiss={dismissChimmyActionCard} />
      ))}
    </section>
  )
}
