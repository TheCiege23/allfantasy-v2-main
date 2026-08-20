import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCareerCard } from '@/lib/dashboard-intel/careerCardService'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The viewer's Manager Career Card (self only — aggregated Legacy identity). */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const force = req.nextUrl.searchParams?.get('force') === '1'
  const card = await getCareerCard(userId, { force })
  return NextResponse.json({ card })
}
