/** The signed-in reader's league groups, across every league they are in (lib/league-groups). */
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { listLeagueGroupsFor } from '@/lib/league-groups/leagueGroupsRead'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ groups: await listLeagueGroupsFor(userId) })
  } catch {
    return NextResponse.json({ error: 'Could not read your leagues right now.' }, { status: 503 })
  }
}
