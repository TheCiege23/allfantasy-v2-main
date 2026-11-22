import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { z } from 'zod'
import { approveSeasonAccounting, governanceAction, ownerRecoveryAction, previewSeasonAccounting, readSeasonOperations, ZombieOperationsError } from '@/lib/zombie/seasonOperations'
import { saveAcceptanceEvidence, sportAcceptanceEvidence } from '@/lib/zombie/acceptanceEvidence'
export const dynamic = 'force-dynamic'
const schema = z.object({ leagueId: z.string().min(1).max(64), action: z.enum(['preview', 'approve', 'configure', 'propose', 'second', 'vote', 'finalize', 'contact', 'respond', 'replace', 'acceptance']),
  reviewId: z.string().max(180).optional(), hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), reason: z.string().max(2000).optional(),
  funding: z.object({ externalWeeklyIncludedInLedger: z.boolean().optional(), ultimateOpeningCents: z.number().int().min(0).max(100_000_000).optional(), ultimateContributionsConfirmed: z.boolean().optional(), ultimateReference: z.string().max(160).optional(), previousAllocationReference: z.string().max(160).optional() }).strict().optional(),
  input: z.record(z.string(), z.unknown()).optional() }).strict()
async function actor() { return ((await getServerSession(authOptions as never)) as { user?: { id?: string } } | null)?.user?.id }
export async function GET(req: Request) {
  const userId = await actor(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(req.url).searchParams, leagueId = params.get('leagueId')
  if (!leagueId || leagueId.length > 64) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  try { return NextResponse.json(params.get('view') === 'sports' ? { sports: await sportAcceptanceEvidence(leagueId, userId) } : await readSeasonOperations(leagueId, userId)) }
  catch (e) { return NextResponse.json({ error: e instanceof ZombieOperationsError ? e.message : 'Operations unavailable' }, { status: 403 }) }
}
export async function POST(req: Request) {
  const userId = await actor(); if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Provide a valid operation and fields' }, { status: 400 })
  const b = parsed.data
  try {
    if (b.action === 'preview') {
      const row = await previewSeasonAccounting(b.leagueId, userId, b.funding ?? {})
      if (row.kind === 'accounting_close') return NextResponse.json({ receipt: row, alreadyApproved: true })
      const saved = row.payload as { hash: string; plan: unknown }
      return NextResponse.json({ review: { id: row.id, hash: saved.hash, plan: saved.plan } })
    }
    if (b.action === 'approve' && b.reviewId && b.hash && b.reason) return NextResponse.json({ receipt: await approveSeasonAccounting(b.leagueId, userId, b.reviewId, b.hash, b.reason) })
    if (['configure', 'propose', 'second', 'vote', 'finalize'].includes(b.action)) return NextResponse.json({ record: await governanceAction(b.leagueId, userId, b.action as 'configure' | 'propose' | 'second' | 'vote' | 'finalize', b.input ?? {}) })
    if (['contact', 'respond', 'replace'].includes(b.action)) return NextResponse.json({ record: await ownerRecoveryAction(b.leagueId, userId, b.action as 'contact' | 'respond' | 'replace', b.input ?? {}) })
    if (b.action === 'acceptance') return NextResponse.json({ record: await saveAcceptanceEvidence(b.leagueId, userId, b.input ?? {}) })
    return NextResponse.json({ error: 'Required operation fields are missing' }, { status: 400 })
  } catch (e) { return NextResponse.json({ error: e instanceof ZombieOperationsError ? e.message : 'Operation did not complete. Refresh its saved state before retrying.' }, { status: 409 }) }
}
