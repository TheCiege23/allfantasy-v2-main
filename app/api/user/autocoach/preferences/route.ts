import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  parseAutoCoachUserPreferences,
  serializeAutoCoachPreferences,
  AutoCoachUserPreferencesSchema,
  type AutoCoachUserPreferences,
} from '@/lib/autocoach/autoCoachPreferences'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/autocoach/preferences
 * Retrieve user's AutoCoach preferences
 */
export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { autoCoachPreferences: true },
    })

    const prefs = parseAutoCoachUserPreferences(profile?.autoCoachPreferences ?? null)

    return NextResponse.json({
      preferences: prefs,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[AutoCoachPreferences GET]', e)
    return NextResponse.json({ error: 'Failed to retrieve preferences' }, { status: 500 })
  }
}

/**
 * PUT /api/user/autocoach/preferences
 * Update user's AutoCoach preferences
 */
export async function PUT(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid preferences' }, { status: 400 })
    }

    /*
     * ⚠ MERGE OVER WHAT IS STORED, THEN VALIDATE. Parsing the body alone filled every field it
     * omitted with the schema DEFAULT, so a client sending `{ aggressiveness }` (the hook's
     * `Partial<>` contract) silently reset exclusions and position overrides to empty.
     */
    const existing = await prisma.userProfile.findUnique({
      where: { userId },
      select: { autoCoachPreferences: true },
    })
    const stored = parseAutoCoachUserPreferences(existing?.autoCoachPreferences ?? null)
    const validated = AutoCoachUserPreferencesSchema.parse({ ...stored, ...(body as Record<string, unknown>) })

    // Serialize for storage
    const serialized = serializeAutoCoachPreferences(validated)

    // Update profile
    const updated = await prisma.userProfile.update({
      where: { userId },
      data: { autoCoachPreferences: serialized as any },
      select: { autoCoachPreferences: true },
    })

    const saved = parseAutoCoachUserPreferences(updated.autoCoachPreferences)

    return NextResponse.json({
      preferences: saved,
      updated: true,
      timestamp: new Date().toISOString(),
    })
  } catch (e: any) {
    console.error('[AutoCoachPreferences PUT]', e)
    if (e.name === 'ZodError') {
      return NextResponse.json(
        { error: 'Validation failed', issues: e.issues },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
  }
}

/**
 * POST /api/user/autocoach/preferences/reset
 * Reset to default preferences
 */
export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Default preferences
    const defaults = AutoCoachUserPreferencesSchema.parse({})
    const serialized = serializeAutoCoachPreferences(defaults)

    const updated = await prisma.userProfile.update({
      where: { userId },
      data: { autoCoachPreferences: serialized as any },
      select: { autoCoachPreferences: true },
    })

    const saved = parseAutoCoachUserPreferences(updated.autoCoachPreferences)

    return NextResponse.json({
      preferences: saved,
      reset: true,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[AutoCoachPreferences POST (reset)]', e)
    return NextResponse.json({ error: 'Failed to reset preferences' }, { status: 500 })
  }
}
