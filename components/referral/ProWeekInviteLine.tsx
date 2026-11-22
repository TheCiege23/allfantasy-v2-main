'use client'

import { useEffect, useState } from 'react'
import { isInIosAppClient } from '@/lib/platform/iosApp'
import { useProWeekOffer } from '@/lib/referral/useProWeekOffer'

/**
 * One line under a leaguemate invite (2026-11-15): what the invite earns, "give a week, get a week"
 * (lib/referral/proWeek.ts). The link itself carries the inviter's referral code; this says why that
 * matters. 🛑 Never in the iOS app (App Store 3.1.1 / 3.1.3) — not mounted there, and the offer endpoint
 * answers `days: 0` to it anyway. Says nothing while the offer is off.
 */
export function ProWeekInviteLine() {
  const [inIosApp, setInIosApp] = useState(true)
  useEffect(() => setInIosApp(isInIosAppClient()), [])
  const offer = useProWeekOffer(!inIosApp)
  if (inIosApp || offer.days <= 0) return null
  return (
    <p className="af-im-field-help" data-testid="invite-pro-week-line">
      <strong>When they bring their team, you both get {offer.days} days of AF Pro, free.</strong>
    </p>
  )
}
