import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { canCommissionerAct, commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import {
  DRAFT_PLAYLIST_SETTINGS_KEY,
  parsePlaylistChoice,
  readDraftPlaylist,
  type StoredDraftPlaylist,
} from '@/lib/draft-room/draftPlaylist'

/**
 * The commissioner's draft playlist (lib/draft-room/draftPlaylist.ts).
 * GET: any member of the draft — the playlist, and whether this viewer may set it.
 * PUT: a commissioner with AF Commissioner or AF Supreme — `{ stationId }`, or `{ stationId: null }` to clear.
 */

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ leagueId: string }> }
type SessionUser = { id?: string; email?: string | null; username?: string | null }

async function sessionUser(): Promise<SessionUser | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: SessionUser } | null
  return session?.user?.id ? session.user : null
}

async function readPlaylist(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  return league ? readDraftPlaylist(league.settings) : null
}

export async function GET(_req: Request, { params }: Ctx) {
  const user = await sessionUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  if (!(await canAccessLeagueDraft(leagueId, user.id))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [playlist, commissioner] = await Promise.all([readPlaylist(leagueId), canCommissionerAct(leagueId, user.id, 'league')])
  const hasPlan = commissioner ? await hasAfCommissionerPlan(user) : false
  return NextResponse.json({
    playlist,
    isCommissioner: commissioner,
    canSet: commissioner && hasPlan,
    planRequired: commissioner && !hasPlan,
  })
}

export async function PUT(req: Request, { params }: Ctx) {
  const user = await sessionUser()
  if (!user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params

  const refusal = await commissionerAccessResponse(leagueId, user.id, 'league')
  if (refusal) return refusal
  if (!(await hasAfCommissionerPlan(user))) {
    return NextResponse.json(
      { error: 'A draft playlist is part of AF Commissioner and AF Supreme.', upgrade: true, upgradeUrl: '/commissioner-upgrade' },
      { status: 402 },
    )
  }

  const stationId = parsePlaylistChoice(await req.json().catch(() => null))
  if (stationId === undefined) return NextResponse.json({ error: 'Pick one of the AllFantasy stations.' }, { status: 400 })

  // jsonb, one key: a concurrent save of any other league setting cannot be overwritten by this one.
  if (stationId === null) {
    await prisma.$executeRaw`
      UPDATE leagues SET settings = settings - ${DRAFT_PLAYLIST_SETTINGS_KEY}::text
      WHERE id = ${leagueId} AND jsonb_typeof(settings) = 'object'`
  } else {
    const stored: StoredDraftPlaylist = { stationId, setAt: new Date().toISOString(), setBy: user.id }
    await prisma.$executeRaw`
      UPDATE leagues SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
        ARRAY[${DRAFT_PLAYLIST_SETTINGS_KEY}]::text[], ${JSON.stringify(stored)}::jsonb)
      WHERE id = ${leagueId}`
  }
  return NextResponse.json({ playlist: await readPlaylist(leagueId) })
}
