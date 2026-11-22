'use client'

import { BookOpen } from 'lucide-react'
import { useMessages } from '@/components/i18n/useMessages'
import { defineMessages } from '@/lib/i18n/messages'
import { leagueFormatFaqHref, type LeagueFormatFaqInput } from '@/lib/league/leagueFormatFaq'

const messages = defineMessages({
  en: {
    label: 'Format rules FAQ',
    hint: 'General format rules. Check your league settings for its exact rules. Opens in a new tab.',
  },
  es: {
    label: 'Reglas del formato',
    hint: 'Reglas generales del formato. Consulta la configuración de tu liga para ver sus reglas exactas. Se abre en una pestaña nueva.',
  },
})

/** Available to every member; preserves their current league tab. */
export function LeagueFormatFaqLink({ league = {}, href, className = '' }: {
  league?: LeagueFormatFaqInput
  href?: string
  className?: string
}) {
  const m = useMessages(messages)
  return <a href={href ?? leagueFormatFaqHref(league)} target="_blank" rel="noopener noreferrer"
    title={m.hint} className={'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold underline underline-offset-4 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' + className}>
    <BookOpen size={15} className="shrink-0" aria-hidden="true" />{m.label}
  </a>
}
