/**
 * POST /api/leagues/templates/from-league
 * Create a template from an existing league (body: { leagueId, name?, description? }).
 * User must own the league. Saves the rules recipe the create wizard can start from
 * (lib/rule-templates/recipe.ts) alongside the legacy payload.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saveTemplateFromLeague } from '@/lib/rule-templates/templateService'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string; name?: string; description?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const result = await saveTemplateFromLeague(session.user.id, {
    leagueId,
    name: typeof body.name === 'string' ? body.name : undefined,
    description: body.description ?? null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: 'League not found or access denied' }, { status: 404 })
  }
  return NextResponse.json(result.template)
}
