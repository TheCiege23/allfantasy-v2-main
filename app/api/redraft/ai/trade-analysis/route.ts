import { NextRequest, NextResponse } from 'next/server'
import { analyzeTrade } from '@/lib/redraft/ai/tradeAnalyzer'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof Response) return gate
  const userId = gate

  let body: { tradeId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const tradeId = body.tradeId?.trim()
  if (!tradeId) return NextResponse.json({ error: 'tradeId required' }, { status: 400 })

  const analysis = await analyzeTrade(userId, tradeId)
  if (!analysis) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

  return NextResponse.json({ analysis })
}
