'use client'
import { useEffect, useState } from 'react'

export default function LocalDateTime({ value }: { value: string | Date | null }) {
  const date = value == null ? null : new Date(value)
  const iso = date && Number.isFinite(date.getTime()) ? date.toISOString() : null
  const [label, setLabel] = useState<string | null>(null)
  useEffect(() => {
    setLabel(iso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)) : null)
  }, [iso])
  if (!iso) return <span>Time unavailable</span>
  return <time dateTime={iso} title={new Date(iso).toUTCString()}>{label ?? new Date(iso).toUTCString()}</time>
}
