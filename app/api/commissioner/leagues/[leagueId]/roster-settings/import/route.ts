import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  checkCommissionerPermission,
  mapImportedRosterToLeagueConfig,
  previewImportedRosterForLeague,
} from '@/lib/roster-engine'
import { invalidateLeagueDraftCaches } from '@/lib/league/invalidateLeagueDraftCaches'
import { applyRosterTemplateChange } from '@/lib/draft/syncDraftRoundsToRoster'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'
import { decideSettingsEdit, recordMidSeasonSettingsChange } from '@/lib/league/settingsLifecycleGate'

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

  // A preview changes nothing; only applying an import is a roster-settings write.
  const locked = action !== 'preview' ? await settingsLockedResponse(leagueId, 'rosters') : null
  if (locked) return locked
  if (!sourcePlatform) return NextResponse.json({ error: 'sourcePlatform required' }, { status: 400 })
  if (!importedConfig || typeof importedConfig !== 'object') {
    return NextResponse.json({ error: 'importedConfig required' }, { status: 400 })
  }

  try {
    if (action === 'apply') {
      const lifecycle = await decideSettingsEdit(leagueId, session.user.id, 'roster', body)
      if (!lifecycle.ok) return NextResponse.json(lifecycle.body, { status: lifecycle.status })
      const config = await mapImportedRosterToLeagueConfig(leagueId, sourcePlatform, importedConfig)
      invalidateLeagueDraftCaches(leagueId)
      // An imported roster is a roster change like any other: draft rounds and roster limits follow.
      // Like reset-default, it asks for the imported shape, so no manual round count survives it.
      const draftRounds = await applyRosterTemplateChange(leagueId, { keepManualOverride: false, logTag: 'roster-settings import' })
      await recordMidSeasonSettingsChange(lifecycle, { leagueId: leagueId, userId: session.user.id, section: 'roster', source: 'roster-settings/import', detail: { sourcePlatform } })
      return NextResponse.json({ ok: true, action: 'apply', unifiedConfig: config, draftRounds })
    }

    const preview = await previewImportedRosterForLeague(leagueId, sourcePlatform, importedConfig)
    return NextResponse.json({ ok: true, action: 'preview', ...preview })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to import roster' }, { status: 400 })
  }
}
