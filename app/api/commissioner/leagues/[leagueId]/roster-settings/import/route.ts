import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  checkCommissionerPermission,
  mapImportedRosterToLeagueConfig,
  previewImportedRosterForLeague,
} from '@/lib/roster-engine'
import { invalidateLeagueDraftCaches } from '@/lib/league/invalidateLeagueDraftCaches'
import { settingsLifecycleRefusal } from '@/lib/league/settingsLifecycleGate'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await params
  const permission = await checkCommissionerPermission(session.user.id, leagueId)
  if (!permission.isCommissioner) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action = String(body.action ?? 'preview').toLowerCase()
  const sourcePlatform = String(body.sourcePlatform ?? '').trim()
  const importedConfig = body.importedConfig as Record<string, number> | undefined

  if (!sourcePlatform) return NextResponse.json({ error: 'sourcePlatform required' }, { status: 400 })
  if (!importedConfig || typeof importedConfig !== 'object') {
    return NextResponse.json({ error: 'importedConfig required' }, { status: 400 })
  }

  try {
    if (action === 'apply') {
      const lifecycleRefusal = await settingsLifecycleRefusal(leagueId, session.user.id, 'roster')
      if (lifecycleRefusal) return NextResponse.json({ error: lifecycleRefusal.error, code: lifecycleRefusal.code }, { status: lifecycleRefusal.status })
      const config = await mapImportedRosterToLeagueConfig(leagueId, sourcePlatform, importedConfig)
      invalidateLeagueDraftCaches(leagueId)
      return NextResponse.json({ ok: true, action: 'apply', unifiedConfig: config })
    }

    const preview = await previewImportedRosterForLeague(leagueId, sourcePlatform, importedConfig)
    return NextResponse.json({ ok: true, action: 'preview', ...preview })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to import roster' }, { status: 400 })
  }
}
