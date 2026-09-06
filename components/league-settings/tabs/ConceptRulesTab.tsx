'use client'

import { useMemo } from 'react'
import { DevyLeagueSettingsHub } from '@/components/devy/settings/DevyLeagueSettingsHub'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { BestBallSettingsCommissionerPanel } from '@/components/league-settings/BestBallSettingsCommissionerPanel'
import LeagueTypeConfirm from '@/components/league/LeagueTypeConfirm'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

/** Specialty / concept-specific rules — merges JSON under `settings` via `settingsMerge`. */
export function ConceptRulesTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'conceptRules', {
    enabled: canEdit,
  })

  const isDevy = useMemo(() => {
    const raw =
      ctx.league.settings && typeof ctx.league.settings === 'object' && !Array.isArray(ctx.league.settings)
        ? (ctx.league.settings as Record<string, unknown>).devy_league_config
        : undefined
    return ctx.league.leagueType === 'devy' || Boolean(raw)
  }, [ctx.league.leagueType, ctx.league.settings])

  const flags = useMemo(
    () => ({
      guillotine: ctx.league.guillotineMode === true,
      survivor: ctx.league.survivorMode === true,
      bestBall: ctx.league.bestBallMode === true,
      variant: ctx.league.leagueVariant ?? null,
    }),
    [ctx.league.guillotineMode, ctx.league.survivorMode, ctx.league.bestBallMode, ctx.league.leagueVariant],
  )

  return (
    <div className="space-y-8">
      <LeagueTypeConfirm leagueId={leagueId} alwaysShow />

      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h4 className="text-[12px] font-bold uppercase tracking-wide text-cyan-200/80">Concept snapshot</h4>
        <ul className="mt-3 space-y-1.5 text-[12px] text-white/70">
          <li>Guillotine: {flags.guillotine ? 'On' : 'Off'}</li>
          <li>Survivor: {flags.survivor ? 'On' : 'Off'}</li>
          <li>Best ball: {flags.bestBall ? 'On' : 'Off'}</li>
          <li>Variant: {flags.variant ?? '—'}</li>
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-white/45">
          Deep specialty rules (survivor merge, guillotine elimination cadence, tournament brackets) use dedicated
          engines. Use the notes below to attach commissioner metadata to the league JSON blob — saved
          automatically.
        </p>
      </div>

      {isDevy ? (
        <div className="space-y-3">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-white/55">Devy HQ</h4>
          <DevyLeagueSettingsHub ctx={ctx} />
        </div>
      ) : null}

      {flags.bestBall ? (
        <div className="space-y-3">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-white/55">Best Ball Settings</h4>
          <BestBallSettingsCommissionerPanel
            leagueId={ctx.league.id}
            sport={String(ctx.league.sport ?? 'NFL')}
            canEdit={canEdit}
          />
        </div>
      ) : null}

      <div>
        <label className="block">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-white/40">
            Commissioner concept notes (JSON merge)
          </span>
          <textarea
            defaultValue={JSON.stringify(
              (ctx.league.settings as Record<string, unknown> | null)?.concept_rules_overlay ?? {},
              null,
              2,
            )}
            disabled={!canEdit}
            rows={6}
            onBlur={(e) => {
              try {
                const parsed = JSON.parse(e.target.value || '{}')
                if (parsed && typeof parsed === 'object') {
                  queuePatch({
                    settingsMerge: { concept_rules_overlay: parsed },
                  })
                }
              } catch {
                /* invalid JSON — skip */
              }
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/30 px-3 py-2 font-mono text-[11px] text-white/90 outline-none focus:border-cyan-400/35 disabled:opacity-50"
          />
        </label>
        {saving ? <p className="mt-1 text-[11px] text-cyan-300/80">Saving…</p> : null}
      </div>
    </div>
  )
}
