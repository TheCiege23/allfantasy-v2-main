'use client'

import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * The "More detail" note on each Rankings tab (2026-11-20). Rankings.tsx is server-rendered, so the
 * catalog lives in this one client leaf rather than in the screen. Never «waiver» in Spanish.
 */
const rankingsMoreMessages = defineMessages({
  en: {
    community: 'Next to pass — the managers just above you',
    portfolio: 'How my score is built · trends · level ladder',
    league: 'Power score · last synced',
    class: 'How Class is rated',
  },
  es: {
    community: 'Próximos a superar: los mánagers justo por encima de ti',
    portfolio: 'Cómo se forma mi puntuación · tendencias · escalera de niveles',
    league: 'Puntuación de poder · última sincronización',
    class: 'Cómo se calcula la Class',
  },
})

export function RankingsMoreNote({ which }: { which: 'community' | 'portfolio' | 'league' | 'class' }) {
  const m = useMessages(rankingsMoreMessages)
  return <>{m[which]}</>
}
