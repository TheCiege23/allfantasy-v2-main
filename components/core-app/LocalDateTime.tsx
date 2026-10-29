'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useEffect, useState } from 'react'
import { useMessages } from '@/components/i18n/useMessages'
import { corePartsMessages } from '@/lib/core-app/messages/coreParts'

export default function LocalDateTime({ value }: { value: string | Date | null }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(corePartsMessages)
  const date = value == null ? null : new Date(value)
  const iso = date && Number.isFinite(date.getTime()) ? date.toISOString() : null
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    setLabel(iso ? new Intl.DateTimeFormat(language === 'es' ? 'es' : undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)) : null)
  }, [iso, language])
  if (!iso) return <span>{m.timeUnavailable}</span>
  return <time dateTime={iso} title={new Date(iso).toUTCString()}>{label ?? new Date(iso).toUTCString()}</time>
}
