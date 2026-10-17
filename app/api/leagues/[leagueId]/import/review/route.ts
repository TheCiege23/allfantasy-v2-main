import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  listImportReviewTasksForLeague,
  resolveImportReviewTask,
} from '@/lib/league-import/importReviewService'
import { resolveLeagueAccess } from '@/lib/league-access'

export async function GET(_req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLeagueAccess(params.leagueId, userId)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const tasks = await listImportReviewTasksForLeague(params.leagueId, userId)
  return NextResponse.json({ tasks })
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const params = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLeagueAccess(params.leagueId, userId)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const taskId = typeof body.taskId === 'string' ? body.taskId : ''
  const note = typeof body.note === 'string' ? body.note : null
  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 })
  }

  const out = await resolveImportReviewTask({
    taskId,
    userId,
    leagueId: params.leagueId,
    note,
  })
  if (!out.ok) {
    return NextResponse.json({ error: out.error }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
