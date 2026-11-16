import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/adminAuth'
import { listStaffThreads } from '@/lib/support/supportInbox'

export const dynamic = 'force-dynamic'

/** GET /api/admin/support?status=needs_reply|answered|closed|all — the support inbox. Admin only. */
export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const s = new URL(req.url).searchParams.get('status')
  const status = s === 'needs_reply' || s === 'answered' || s === 'closed' ? s : 'all'
  return NextResponse.json({ threads: await listStaffThreads({ status }) }, { headers: { 'cache-control': 'private, no-store' } })
}
