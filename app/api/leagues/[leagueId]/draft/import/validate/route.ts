/**
 * POST: Validate import payload (dry-run). Returns preview and error report. Does not write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import {
  parseImportPayload,
  runDraftImportDryRun,
  buildLeagueImportContext,
} from '@/lib/draft-import'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  if (!uiSettings.importEnabled) {
    return NextResponse.json({ error: 'Draft import is disabled by commissioner settings.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const input = body.payload ?? body
  const { payload, parseError } = parseImportPayload(input)
  if (parseError) {
    return NextResponse.json({
      valid: false,
      parseError,
      report: { errors: [{ code: 'PARSE_ERROR', message: parseError }], warnings: [], canProceed: false },
      preview: null,
    })
  }

  const [league, draftSession] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { leagueSize: true },
    }),
    prisma.draftSession.findUnique({
      where: { leagueId },
      select: {
        rounds: true,
        teamCount: true,
        slotOrder: true,
        status: true,
        picks: { select: { id: true } },
      },
    }),
  ])

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { ownerName: true, teamName: true },
    orderBy: { id: 'asc' },
  })
  const teamCount = draftSession?.teamCount ?? league?.leagueSize ?? (rosters.length > 0 ? rosters.length : 12)
  const rounds = draftSession?.rounds ?? 15
  const rosterNameById = rosters.reduce<Record<string, string>>((acc, roster, index) => {
    acc[roster.id] = teams[index]?.ownerName || teams[index]?.teamName || `Team ${index + 1}`
    return acc
  }, {})

  const slotOrder = Array.isArray(draftSession?.slotOrder)
    ? (draftSession?.slotOrder as Array<{ rosterId?: string; displayName?: string; slot?: number }>)
    : []
  const rosterInfos = slotOrder.length > 0
    ? slotOrder
        .map((slot, index) => {
          const rosterId = typeof slot.rosterId === 'string' ? slot.rosterId : null
          if (!rosterId) return null
          return {
            id: rosterId,
            displayName: slot.displayName || rosterNameById[rosterId] || `Team ${index + 1}`,
          }
        })
        .filter((entry): entry is { id: string; displayName: string } => Boolean(entry))
    : rosters.map((roster, index) => ({
        id: roster.id,
        displayName: rosterNameById[roster.id] || `Team ${index + 1}`,
      }))

  const importCtx = buildLeagueImportContext(leagueId, teamCount, rounds, rosterInfos)

  const result = runDraftImportDryRun(payload, importCtx, {
    existingPickCount: draftSession?.picks?.length ?? 0,
    sessionStatus: draftSession?.status ?? 'pre_draft',
  })

  return NextResponse.json({
    valid: result.valid,
    report: result.report,
    preview: result.preview,
  })
}
