import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getHighlightReport } from '@/lib/analytics/highlightReport'

export const dynamic = 'force-dynamic'
export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const headers = { 'Cache-Control': 'private, no-store' }
  try { return NextResponse.json(await getHighlightReport(), { headers }) }
  catch { return NextResponse.json({ error: 'Highlight analytics could not be loaded.' }, { status: 503, headers }) }
}
