import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { afcConflictMessage, afcOverrideInput, initializeAfcPilot, loadAfcPilot, saveAfcOverride } from '@/lib/afc-championships/staging'

type Context = { params: Promise<{ leagueId: string }> }

async function mutate(
  context: Context,
  access: 'owner' | 'bracket',
  action: (pilot: NonNullable<Awaited<ReturnType<typeof loadAfcPilot>>>) => Promise<void>,
) {
  const { leagueId } = await context.params
  const { appUserId } = await resolvePlatformUser()
  const pilot = appUserId ? await loadAfcPilot(leagueId, appUserId, access) : null
  if (!pilot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    await action(pilot)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const conflict = afcConflictMessage(error)
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 })
    throw error
  }
}

export async function POST(_req: NextRequest, context: Context) {
  return mutate(context, 'owner', initializeAfcPilot)
}

export async function PUT(req: NextRequest, context: Context) {
  const input = afcOverrideInput.safeParse(await req.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: 'Enter a valid round and its pairings.' }, { status: 400 })
  return mutate(context, 'bracket', pilot => saveAfcOverride(pilot, input.data))
}
