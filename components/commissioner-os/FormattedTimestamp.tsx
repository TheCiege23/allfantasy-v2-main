'use client'

import { useEffect, useState } from 'react'

/**
 * Formats an ISO timestamp only after mount, so the browser's locale and
 * time zone are the only ones that ever render it. `toLocaleString` with no
 * locale or time zone gives one string on the server and another in the
 * browser; the two did not match and hydration failed (React error #422)
 * for any reader whose locale or zone differs from the server's. The server
 * and the first client render both emit an empty span, so they always agree.
 */
export function FormattedTimestamp({ iso }: { iso: string }) {
  const [formatted, setFormatted] = useState('')

  useEffect(() => {
    setFormatted(new Date(iso).toLocaleString())
  }, [iso])

  return <span>{formatted}</span>
}
