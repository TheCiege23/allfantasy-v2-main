import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { resolveContractCaptureRequester } from '@/lib/admin/contractCapture/captureGate'
import {
  ContractCaptureInputError,
  listOwnCaptureLeagues,
  runContractCapture,
} from '@/lib/admin/contractCapture/contractCaptureService'
import { ContractCaptureRedactionError } from '@/lib/admin/contractCapture/redactContractCapture'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** The requesting admin's OWN Yahoo/ESPN NFL leagues, for the picker. Reads Postgres only. */
export async function GET() {
  // The admin gate is checked here, in the route itself, as every /api/admin route does
  // (__tests__/admin-api-protection.test.ts); the requester check then also binds the app session.
  const admin = await requireAdmin()
  if (!admin.ok) return admin.res
  const gate = await resolveContractCaptureRequester()
  if (!gate.ok) return gate.res
  const leagues = await listOwnCaptureLeagues(gate.userId)
  return NextResponse.json({ leagues }, { headers: NO_STORE })
}

/**
 * One owner-only contract capture, returned as a redacted JSON download. The body takes exactly two
 * fields — `leagueId` (an AllFantasy league id) and `week` — and anything else is ignored. See
 * lib/admin/contractCapture/contractCaptureService.ts.
 */
export async function POST(request: Request) {
  // The admin gate is checked here, in the route itself, as every /api/admin route does
  // (__tests__/admin-api-protection.test.ts); the requester check then also binds the app session.
  const admin = await requireAdmin()
  if (!admin.ok) return admin.res
  const gate = await resolveContractCaptureRequester()
  if (!gate.ok) return gate.res

  const body = (await request.json().catch(() => null)) as { leagueId?: unknown; week?: unknown } | null
  try {
    const capture = await runContractCapture({ userId: gate.userId, leagueId: body?.leagueId, week: body?.week })
    return new Response(capture.json, {
      status: 200,
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${capture.filename}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof ContractCaptureInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE })
    }
    if (error instanceof ContractCaptureRedactionError) {
      console.warn('[contract-capture] refused: %d value(s) survived redaction', error.survivingCount)
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE })
    }
    // Never echo the error: a provider error can carry request details.
    console.warn('[contract-capture] failed: %s', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'The capture failed. Nothing was saved.' }, { status: 502, headers: NO_STORE })
  }
}
