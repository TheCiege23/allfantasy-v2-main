import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { decideRedraftRenewal } from '@/lib/redraft/renewal/CanonicalRedraftRenewalService'
export async function POST(req: NextRequest, { params }: { params: { renewalId: string } }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { decision?: 'renew' | 'decline' } | null
  if (body?.decision !== 'renew' && body?.decision !== 'decline') return NextResponse.json({ error: 'decision must be renew or decline' }, { status: 400 })
  try { return NextResponse.json(await decideRedraftRenewal({ renewalId: params.renewalId, userId, decision: body.decision })) }
  catch (error) { const message = error instanceof Error ? error.message : 'Decision failed'; return NextResponse.json({ error: message }, { status: message === 'SLOT_NOT_FOUND' ? 403 : 409 }) }
}