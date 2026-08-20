'use client'

import Link from 'next/link'
import { useGeoRestriction } from '@/lib/geo/useGeoRestriction'
import '@/components/core-app/af-geo.css'

/**
 * "Paid features aren't available in your state."
 *
 * ⚠ THIS IS THE ONE ITEM IN THE CUTOVER LEDGER WHERE DROPPING IT IS NOT A PRODUCT
 * DECISION. /dashboard scopes itself by state and routes to /paid-restricted;
 * /core had no equivalent, so retiring the old dashboard without carrying this
 * would have started offering paid plans in states where we have determined we
 * cannot sell them. Every other blocker on that list costs a feature. This one
 * costs compliance.
 *
 * ⚠ RENDERS NOTHING WHILE LOADING, AND THAT DIRECTION IS DELIBERATE. The hook
 * starts with `loading: true` and no state code. Showing a restriction banner
 * before we know where someone is would tell unrestricted users they cannot buy;
 * showing nothing briefly tells restricted users nothing they will not learn a
 * moment later, and checkout itself is independently gated on the same signal —
 * the surfaces that take money do not rely on this banner to stop anyone.
 */
export function GeoRestrictionNotice() {
  const geo = useGeoRestriction()

  if (geo.loading || !geo.isPaidBlocked) return null

  const where = geo.stateName ?? geo.stateCode
  return (
    <div className="af-geo" role="status">
      <div className="af-geo-body">
        <p className="af-geo-title">
          {where
            ? `Paid features aren't available in ${where}.`
            : "Paid features aren't available in your location."}
        </p>
        {/*
          ⚠ SAYS WHAT STILL WORKS, NOT ONLY WHAT DOES NOT. Everything free stays
          free here, and a notice that only announced a restriction would read as
          "this product is closed to you" when most of it is not.
        */}
        <p className="af-geo-sub">
          Your leagues, live scores, standings and lineup tools all keep working — only
          subscriptions and token purchases are unavailable.
        </p>
      </div>
      {geo.stateCode ? (
        <Link href={`/paid-restricted?state=${geo.stateCode}`} className="af-geo-link">
          Learn more
        </Link>
      ) : null}
    </div>
  )
}

export default GeoRestrictionNotice
