'use client'

import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

interface LeagueSettingsTabProps {
  leagueId: string
  canEdit: boolean
}

interface LeagueInfo {
  name: string
  sport: string
  season: number
  leagueSize: number
  scoring: string
  rosterSize: number
  isDynasty: boolean
  leagueType: string
  leagueVariant: string | null
  waiverType: string
  waiverBudget: number
  tradeReviewHours: number
  tradeDeadlineWeek: number
  playoffTeams: number
  playoffStartWeek: number
  medianGame: boolean
  /** `settings.median_game_in_playoffs` — off unless the commissioner turned it on. */
  medianGameInPlayoffs?: boolean
  timezone: string
  [key: string]: unknown
}

function SettingRow({ label, value, editable, children }: {
  label: string; value?: string | number | boolean; editable?: boolean; children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-sm text-white/80">{label}</span>
      <div className="flex-shrink-0 text-sm">
        {children ?? (
          <span className={editable ? 'text-white' : 'text-white/50'}>
            {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : (value ?? '—')}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * League Settings Tab — basic settings shared across ALL league types.
 * All members see this in read-only mode. Commissioners can edit.
 */
export function LeagueSettingsTab({ leagueId, canEdit }: LeagueSettingsTabProps) {
  const [league, setLeague] = useState<LeagueInfo | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/league/settings?leagueId=${leagueId}`)
      .then((r) => r.json())
      .then((d) => setLeague(d))
      .catch(() => {})
  }, [leagueId])

  const save = useCallback(async (key: string, value: unknown) => {
    if (!canEdit) return
    setSaving(true)
    await fetch(`/api/league/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, [key]: value }),
    }).catch(() => {})
    setLeague((l) => l ? { ...l, [key]: value } : l)
    setSaving(false)
  }, [leagueId, canEdit])

  if (!league) return <div className="text-sm text-white/40">Loading...</div>

  return (
    <div className="space-y-6">
      {saving && <div className="text-xs text-cyan-300 animate-pulse">Saving...</div>}

      {/* General Info */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-white/70 uppercase tracking-wide">General</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <SettingRow label="League Name" editable={canEdit}>
            {canEdit ? (
              <Input className="w-48 text-right" value={league.name ?? ''} onChange={(e) => save('name', e.target.value)} />
            ) : (
              <span className="text-white">{league.name}</span>
            )}
          </SettingRow>
          <SettingRow label="Sport" value={league.sport} />
          <SettingRow label="Season" value={league.season} />
          <SettingRow label="Teams" value={league.leagueSize} />
          <SettingRow label="Format" value={league.leagueVariant ?? league.leagueType} />
          <SettingRow label="Dynasty" value={league.isDynasty} />
          <SettingRow label="Timezone" value={league.timezone ?? 'America/New_York'} />
        </div>
      </section>

      {/* Scoring */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-white/70 uppercase tracking-wide">Scoring</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <SettingRow label="Scoring Format" value={league.scoring ?? 'PPR'} />
          <SettingRow label="Roster Size" value={league.rosterSize} />
          <SettingRow label="Median Game" editable={canEdit}>
            {canEdit ? (
              <Switch checked={league.medianGame ?? false} onCheckedChange={(v) => save('medianGame', v)} />
            ) : (
              <span className="text-white/50">{league.medianGame ? 'Yes' : 'No'}</span>
            )}
          </SettingRow>
          {league.medianGame ? (
            <SettingRow label="League median in playoffs" editable={canEdit}>
              {canEdit ? (
                <Switch
                  aria-label="League median in playoffs. Off: playoff weeks are win-or-go-home only."
                  checked={league.medianGameInPlayoffs === true}
                  onCheckedChange={(v) => save('medianGameInPlayoffs', v)}
                />
              ) : (
                <span className="text-white/50">{league.medianGameInPlayoffs === true ? 'Yes' : 'No — win or go home'}</span>
              )}
            </SettingRow>
          ) : null}
        </div>
      </section>

      {/* Waivers */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-white/70 uppercase tracking-wide">Waivers</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <SettingRow label="Waiver Type" editable={canEdit}>
            {canEdit ? (
              <select className="rounded bg-white/5 border border-white/10 px-2 py-1 text-sm text-white"
                value={league.waiverType ?? 'rolling'}
                onChange={(e) => save('waiverType', e.target.value)}>
                <option value="rolling">Rolling</option>
                <option value="faab">FAAB</option>
                <option value="reverse_standings">Reverse Standings</option>
              </select>
            ) : (
              <span className="text-white/50">{league.waiverType}</span>
            )}
          </SettingRow>
          <SettingRow label="FAAB Budget" value={league.waiverBudget} />
        </div>
      </section>

      {/* Trades */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-white/70 uppercase tracking-wide">Trades</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <SettingRow label="Trade Review Period (hours)" editable={canEdit}>
            {canEdit ? (
              <Input type="number" className="w-20 text-right" value={league.tradeReviewHours ?? 24}
                onChange={(e) => save('tradeReviewHours', Number(e.target.value))} />
            ) : (
              <span className="text-white/50">{league.tradeReviewHours ?? 24}h</span>
            )}
          </SettingRow>
          <SettingRow label="Trade Deadline Week" value={league.tradeDeadlineWeek} />
        </div>
      </section>

      {/* Playoffs */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-white/70 uppercase tracking-wide">Playoffs</h3>
        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
          <SettingRow label="Playoff Teams" editable={canEdit}>
            {canEdit ? (
              <Input type="number" className="w-20 text-right" min={2} value={league.playoffTeams ?? 6}
                onChange={(e) => save('playoffTeams', Number(e.target.value))} />
            ) : (
              <span className="text-white/50">{league.playoffTeams}</span>
            )}
          </SettingRow>
          <SettingRow label="Playoff Start Week" value={league.playoffStartWeek} />
        </div>
      </section>
    </div>
  )
}
