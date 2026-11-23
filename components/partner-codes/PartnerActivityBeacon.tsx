'use client'

import { useEffect } from 'react'

/**
 * Commissioner Partner Codes: tells the server "this member opened AF today", at most once a day per
 * browser. Feeds the active-user meter (lib/partner-codes/jobs.ts). Renders nothing; the server
 * no-ops unless PARTNER_CODES_ENABLED=1 and the member joined with a code.
 */
export function PartnerActivityBeacon() {
  useEffect(() => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      if (window.localStorage.getItem('af_partner_seen') === today) return
      window.localStorage.setItem('af_partner_seen', today)
      void fetch('/api/partner-codes/seen', { method: 'POST', keepalive: true }).catch(() => null)
    } catch {
      // Private mode / storage disabled: skip. It is a meter, not a feature.
    }
  }, [])
  return null
}
