/**
 * GET /api/leagues/[leagueId]/survivor/idols
 * Returns idol inventory for the requesting user.
 * - Own idols: always visible (status, power, play window).
 * - Other players' idols: hidden unless commissioner or revealed (played/used).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'

export const dynamic = 'force-dynamic'

type IdolRow = {
  id: string
  powerType: string
  status: string
  assignedAt: Date
  usedAt: Date | null
  expiredAt: Date | null
  expiresAtWeek: number | null
  currentOwnerUserId: string | null
  originalOwnerUserId: string | null
  rosterId: string
  playerId: string
  isPubliclyKnown: boolean
  isSecret: boolean
  isUsed: boolean
  powerLabel: string | null
}

function isPublicIdol(row: Pick<IdolRow, 'status' | 'isPubliclyKnown'>): boolean {
  return row.isPubliclyKnown
}

function redactIdol(row: IdolRow, owned: boolean, canSeeHidden: boolean) {
  if (canSeeHidden || owned) return row
  return {
    id: row.id,
    powerType: row.powerType,
    status: row.status,
    assignedAt: null,
    usedAt: row.usedAt,
    expiredAt: row.expiredAt,
    expiresAtWeek: row.expiresAtWeek,
    currentOwnerUserId: null,
    originalOwnerUserId: null,
    rosterId: null,
    playerId: null,
    isPubliclyKnown: row.isPubliclyKnown,
    isSecret: row.isSecret,
    isUsed: row.isUsed,
    powerLabel: isPublicIdol(row) ? row.powerLabel : null,
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!access.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const canSeeHidden = access.decisions.canSeeHiddenIdolAssignments
  const rosterId = access.rosterId
  const idols = await prisma.survivorIdol.findMany({
    where: canSeeHidden
      ? { leagueId }
      : {
          leagueId,
          OR: [
            { currentOwnerUserId: userId },
            { rosterId: rosterId ?? '__none__' },
            { isPubliclyKnown: true },
            ],
        },
    select: {
      id: true,
      powerType: true,
      status: true,
      assignedAt: true,
      usedAt: true,
      expiredAt: true,
      expiresAtWeek: true,
      currentOwnerUserId: true,
      originalOwnerUserId: true,
      rosterId: true,
      playerId: true,
      isPubliclyKnown: true,
      isSecret: true,
      isUsed: true,
      powerLabel: true,
    },
  })
  const visible = idols.map((idol: IdolRow) => {
    const owned = idol.currentOwnerUserId === userId || (rosterId != null && idol.rosterId === rosterId)
    return redactIdol(idol, owned, canSeeHidden)
  })

  return NextResponse.json({
    idols: visible,
    hiddenInventoryVisible: canSeeHidden,
    privacyMode: access.isParticipatingCommissioner ? 'participating_commissioner_redacted' : 'standard',
  })
}
