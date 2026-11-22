import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { draftAiText } from '@/lib/draft/ai-claude'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sys =
    'You are Chimmy. Write a sports-column style draft recap. JSON: {"bestValue":"","biggestReach":"","bestTeam":"","sleeperPick":"","column":""}'
  try {
    const text = await draftAiText(sys, JSON.stringify(body ?? {}), { userId: session.user.id })
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim()
    return NextResponse.json({ result: JSON.parse(cleaned) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Chimmy error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
