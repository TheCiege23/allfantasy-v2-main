import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  parseAutoCoachUserPreferences,
  serializeAutoCoachPreferences,
  type AutoCoachUserPreferences,
} from '@/lib/autocoach/autoCoachPreferences'

export const dynamic = 'force-dynamic'

/**
 * POST /api/user/autocoach/preferences/position-override
 * Add or update position-specific override
 * Body: { position: string, disabled?: boolean, minProjectionDelta?: number }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ action?: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action } = await ctx.params

    if (action === 'position-override') {
      let body: { position?: string; disabled?: boolean; minProjectionDelta?: number }
      try {
        body = await req.json()
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
      }

      const { position, disabled, minProjectionDelta } = body
      if (!position || typeof position !== 'string') {
        return NextResponse.json({ error: 'Missing or invalid position' }, { status: 400 })
      }

      const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { autoCoachPreferences: true },
      })

      const prefs = parseAutoCoachUserPreferences(profile?.autoCoachPreferences ?? null)
      const overrides = prefs.positionOverrides ?? {}
      const pos = position.toUpperCase()

      overrides[pos] = {
        disabled,
        minProjectionDelta,
      }

      prefs.positionOverrides = overrides
      const serialized = serializeAutoCoachPreferences(prefs)

      const updated = await prisma.userProfile.update({
        where: { userId },
        data: { autoCoachPreferences: serialized as any },
        select: { autoCoachPreferences: true },
      })

      const saved = parseAutoCoachUserPreferences(updated.autoCoachPreferences)

      return NextResponse.json({
        preferences: saved,
        position: pos,
        override: overrides[pos],
        timestamp: new Date().toISOString(),
      })
    }

    if (action === 'exclude-player') {
      let body: { playerId?: string; exclude?: boolean }
      try {
        body = await req.json()
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
      }

      const { playerId, exclude } = body
      if (!playerId || typeof playerId !== 'string') {
        return NextResponse.json({ error: 'Missing or invalid playerId' }, { status: 400 })
      }

      const profile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { autoCoachPreferences: true },
      })

      const prefs = parseAutoCoachUserPreferences(profile?.autoCoachPreferences ?? null)
      const excluded = prefs.excludedPlayerIds ?? []

      /*
       * ⚠ REMOVING NEVER WORKED. The remove branch assigned the filtered list and then the line after
       * this block overwrote it with the unfiltered one, so "un-exclude" saved the exclusion again.
       * One assignment, computed per branch.
       */
      prefs.excludedPlayerIds =
        exclude !== false
          ? excluded.includes(playerId)
            ? excluded
            : [...excluded, playerId]
          : excluded.filter((id) => id !== playerId)
      const serialized = serializeAutoCoachPreferences(prefs)

      const updated = await prisma.userProfile.update({
        where: { userId },
        data: { autoCoachPreferences: serialized as any },
        select: { autoCoachPreferences: true },
      })

      const saved = parseAutoCoachUserPreferences(updated.autoCoachPreferences)

      return NextResponse.json({
        preferences: saved,
        playerId,
        excluded: exclude !== false,
        timestamp: new Date().toISOString(),
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('[AutoCoachPreferences action]', e)
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
  }
}
