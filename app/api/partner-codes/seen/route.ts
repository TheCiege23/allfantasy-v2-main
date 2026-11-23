import { NextResponse } from 'next/server'
import { partnerApiUser } from '@/lib/partner-codes/http'
import { recordPartnerReferralActivity } from '@/lib/partner-codes/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Once-a-day "opened AF" ping from PartnerActivityBeacon. Always 204; never fails a page. */
export async function POST() {
  const auth = await partnerApiUser()
  if (auth.ok) await recordPartnerReferralActivity(auth.userId)
  return new NextResponse(null, { status: 204 })
}
