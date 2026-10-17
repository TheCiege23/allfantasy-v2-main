import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { importObservedMarketAdpBoard } from '@/lib/workers/importObservedMarketAdp'
export const runtime = 'nodejs'
export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  try {
    const body = await request.json()
    if (!body.expected || typeof body.dryRun !== 'boolean') return NextResponse.json({ error:'Expected context and explicit dryRun are required' },{status:400})
    const result = await importObservedMarketAdpBoard(body.board,body.expected,body.dryRun)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error:'ADP export rejected: check licensed observed evidence, context, freshness and player identities' },{status:400})
  }
}
