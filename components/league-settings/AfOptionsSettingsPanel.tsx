'use client'

import { useEffect, useState } from 'react'
import { LeagueSettingsPanel } from '@/app/league/[leagueId]/components/settings/LeagueSettingsPanel'
import { useAutosave } from '@/lib/hooks/useAutosave'
import { useMidSeasonConfirm } from '@/components/league-settings/useMidSeasonConfirm'
import { useEntitlements } from '@/hooks/useEntitlements'
import type { CommissionerSettingsFormData } from '@/lib/league/commissioner-league-patch'
import { CO_COMMISSIONER_SCOPES, type CoCommissionerScope } from '@/lib/league/coCommissionerScopes'

/**
 * Settings › League Setup › "AllFantasy options" (owner's page review #12–15, Phase C2): the AllFantasy-only
 * rules that had no editor on an AllFantasy-hosted league's own settings page.
 *
 * - The odd-team extra matchup (lib/redraft/oddTeamExtraMatchupRules.ts, AF Commissioner).
 * - Keeper rules: cost system, round penalty, the round an undrafted pickup costs, the earliest round a
 *   keeper can cost, the selection deadline (lib/keeper).
 *
 * Both were editable only in CommissionerSettingsModal, which the league page mounts for devy, C2C and
 * Survivor leagues only — so a redraft or keeper league's commissioner could not reach them at all. This
 * renders the same sections of the same panel (`LeagueSettingsPanel only="af-options"`) with the same
 * read (GET /api/league/settings) and the same autosave, so there is one editor and one save path.
 */
type SettingsPayload = {
  canEdit?: boolean
  userRole?: string | null
  commissionerScopes?: CoCommissionerScope[]
  hasAfCommissionerSub?: boolean
  settingsSnapshot?: Record<string, unknown>
  league?: CommissionerSettingsFormData & Record<string, unknown>
}

export function AfOptionsSettingsPanel({ leagueId }: { leagueId: string }) {
  const [payload, setPayload] = useState<SettingsPayload | null | undefined>(undefined)
  const { confirm: confirmMidSeason, dialog: midSeasonDialog } = useMidSeasonConfirm()
  const { save, debouncedSave } = useAutosave(leagueId, { confirmMidSeason })
  const { hasCommissioner } = useEntitlements()

  useEffect(() => {
    let live = true
    fetch(`/api/league/settings?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SettingsPayload | null) => { if (live) setPayload(d) })
      .catch(() => { if (live) setPayload(null) })
    return () => { live = false }
  }, [leagueId])

  if (payload === undefined) {
    return <div className="h-24 animate-pulse rounded-xl bg-white/[0.06]" aria-busy="true" />
  }
  if (!payload?.league) {
    return <p role="alert" className="px-6 py-8 text-[13px] text-red-300">Could not load league settings. Try again.</p>
  }
  // League rules are the `league` area: a co-commissioner without it sees them read-only (lib/league/commissionerAccess.ts).
  const scopes = payload.commissionerScopes ?? CO_COMMISSIONER_SCOPES
  const canEdit = Boolean(payload.canEdit) && scopes.includes('league')
  return (
    <>
      {midSeasonDialog}
      <LeagueSettingsPanel
        leagueId={leagueId}
        initialData={payload.league}
        settingsSnapshot={payload.settingsSnapshot ?? {}}
        hasAfCommissionerSub={hasCommissioner || Boolean(payload.hasAfCommissionerSub)}
        canEdit={canEdit}
        save={save}
        debouncedSave={debouncedSave}
        only="af-options"
      />
    </>
  )
}

export default AfOptionsSettingsPanel
