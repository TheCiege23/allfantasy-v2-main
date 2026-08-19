/**
 * Returns the resolved roster template for a league, aggregated into the flat
 * shape consumed by the draft-room team panel (DraftRosterStrip). Uses the same
 * effective template as pool eligibility and pick validation (`getLeagueDraftTemplatePayload`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import {
  getLeagueDraftTemplatePayload,
  orderedSlotLabelsFromTemplate,
} from '@/lib/league/league-draft-template-payload'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId: rawId } = await params
  const leagueId = rawId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 404 ? 'League not found' : 'Forbidden' },
      { status: gate.status },
    )
  }

  const leagueExists = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true },
  })
  if (!leagueExists) return NextResponse.json({ error: 'League not found' }, { status: 404 })

  const payload = await getLeagueDraftTemplatePayload(leagueId).catch(() => null)
  if (!payload) {
    return NextResponse.json({ error: 'Template unavailable' }, { status: 500 })
  }

  const template = payload.template

  // Aggregate template slots into the flat shape DraftRosterStrip consumes.
  const starterSlots: Record<string, number> = {}
  let benchSlots = 0
  let taxiSlots = 0
  let devySlots = 0
  for (const slot of template.slots) {
    if ((slot.starterCount ?? 0) > 0) {
      const key = slot.slotName.trim().toUpperCase()
      starterSlots[key] = (starterSlots[key] ?? 0) + (slot.starterCount ?? 0)
    }
    benchSlots += slot.benchCount ?? 0
    taxiSlots += slot.taxiCount ?? 0
    devySlots += slot.devyCount ?? 0
  }

  const orderedSlotLabels = orderedSlotLabelsFromTemplate(template)

  return NextResponse.json({
    templateId: template.templateId,
    sportType: template.sportType,
    formatType: template.formatType,
    starterSlots,
    benchSlots,
    taxiSlots,
    devySlots,
    slots: template.slots,
    orderedSlotLabels,
    hasPersistedRosterSchema: payload.hasPersistedRosterSchema,
  })
}
