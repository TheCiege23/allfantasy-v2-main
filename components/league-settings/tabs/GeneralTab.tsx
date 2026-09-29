'use client'

import { useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { LeagueRulesSummarySection } from '@/app/league/[leagueId]/components/LeagueRulesSummarySection'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

const TZ_PRESETS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
]

export function GeneralTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'general', {
    enabled: canEdit,
  })

  const [name, setName] = useState(ctx.league.name ?? '')
  const [timezone, setTimezone] = useState(ctx.league.timezone ?? 'America/New_York')
  const [logoUrl, setLogoUrl] = useState(ctx.league.logoUrl ?? '')

  useEffect(() => {
    setName(ctx.league.name ?? '')
    setTimezone(ctx.league.timezone ?? 'America/New_York')
    setLogoUrl(ctx.league.logoUrl ?? '')
  }, [ctx.league.name, ctx.league.timezone, ctx.league.logoUrl])

  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.06)]">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-cyan-200/90">Basics</h3>
          <span
            className="inline-flex items-center gap-1 text-[11px] text-white/35"
            title="Changes save automatically"
          >
            <HelpCircle className="h-3 w-3" aria-hidden />
            Auto-save
          </span>
          {saving ? (
            <span className="ml-auto text-[11px] font-semibold text-cyan-300/80">Saving…</span>
          ) : null}
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            League name
          </span>
          <input
            type="text"
            value={name}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setName(v)
              queuePatch({ name: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            Timezone
          </span>
          <select
            value={timezone}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setTimezone(v)
              queuePatch({ timezone: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {TZ_PRESETS.map((tz) => (
              <option key={tz} value={tz} className="bg-[#0d1117]">
                {tz.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            Logo URL
          </span>
          <input
            type="url"
            value={logoUrl ?? ''}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setLogoUrl(v)
              queuePatch({ logoUrl: v || null })
            }}
            placeholder="https://…"
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        {!canEdit ? (
          <p className="mt-3 text-[11px] text-amber-200/70">Only the commissioner can edit league basics.</p>
        ) : null}
      </div>

      <LeagueRulesSummarySection
        league={ctx.league}
        displayLeague={ctx.displayLeague}
        sleeperSettingsHref={sleeperSettingsHref}
        showEditLink={Boolean(sleeperSettingsHref)}
      />
    </div>
  )
}
