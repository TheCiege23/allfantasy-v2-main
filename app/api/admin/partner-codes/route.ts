import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { loadPartnerSettings, updatePartnerSettings } from '@/lib/partner-codes/service'
import { PartnerSettingsError } from '@/lib/partner-codes/settings'
import { payoutsCsv, reviewReferral, setPayoutStatus } from '@/lib/partner-codes/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET ?export=csv&year=2026 → the paid-payouts CSV for 1099 prep. Otherwise the settings. */
export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const url = new URL(req.url)
  if (url.searchParams.get('export') === 'csv') {
    const year = Number(url.searchParams.get('year')) || new Date().getUTCFullYear()
    return new NextResponse(await payoutsCsv(year), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="partner-payouts-${year}.csv"` },
    })
  }
  return NextResponse.json({ settings: await loadPartnerSettings() })
}

/**
 * POST { action: 'settings', settings: {...} }
 *      { action: 'approve' | 'hold' | 'mark_paid', payoutId, note? }
 *      { action: 'clear' | 'reject', referralId }
 */
export async function POST(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const adminId = (gate.user as { id?: string } | undefined)?.id ?? null
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const action = String(body?.action ?? '')
  try {
    if (action === 'settings') {
      const settings = await updatePartnerSettings((body?.settings ?? {}) as Record<string, unknown>, adminId)
      return NextResponse.json({ ok: true, settings })
    }
    if (action === 'approve' || action === 'hold' || action === 'mark_paid') {
      const payout = await setPayoutStatus(String(body?.payoutId ?? ''), action, adminId, typeof body?.note === 'string' ? body.note : undefined)
      return NextResponse.json({ ok: true, status: payout.status })
    }
    if (action === 'clear' || action === 'reject') {
      await reviewReferral(String(body?.referralId ?? ''), action)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    if (error instanceof PartnerSettingsError) return NextResponse.json({ error: error.message, field: error.field }, { status: 400 })
    return NextResponse.json({ error: (error as Error)?.message ?? 'Failed' }, { status: 400 })
  }
}
