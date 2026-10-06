'use client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useEffect, useState } from 'react'

export default function LocalDateTime({ value }: { value: string | Date | null }) {
  const { language } = useOptionalLanguage()
  const date = value == null ? null : new Date(value)
  const iso = date && Number.isFinite(date.getTime()) ? date.toISOString() : null
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    setLabel(iso ? new Intl.DateTimeFormat(language === 'es' ? 'es' : undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)) : null)
  }, [iso, language])
  if (!iso) return <span>{language === 'es' ? 'Hora no disponible' : 'Time unavailable'}</span>
  return <time dateTime={iso} title={new Date(iso).toUTCString()}>{label ?? new Date(iso).toUTCString()}</time>
}
