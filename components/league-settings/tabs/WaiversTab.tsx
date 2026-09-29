'use client'

import { useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

const WAIVER_TYPES = [
  { value: 'faab', label: 'FAAB (budget)' },
  { value: 'rolling', label: 'Rolling waivers' },
  { value: 'reverse_standings', label: 'Reverse standings' },
]

export function WaiversTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'waivers', { enabled: canEdit })

  const [waiverType, setWaiverType] = useState(ctx.league.waiverType ?? 'rolling')
  const [waiverBudget, setWaiverBudget] = useState(ctx.league.waiverBudget ?? 100)
  const [waiverMinBid, setWaiverMinBid] = useState(ctx.league.waiverMinBid ?? 0)
  const [waiverHours, setWaiverHours] = useState(ctx.league.waiverHours ?? 24)

  useEffect(() => {
    setWaiverType(ctx.league.waiverType ?? 'rolling')
    setWaiverBudget(ctx.league.waiverBudget ?? 100)
    setWaiverMinBid(ctx.league.waiverMinBid ?? 0)
    setWaiverHours(ctx.league.waiverHours ?? 24)
  }, [ctx.league.waiverType, ctx.league.waiverBudget, ctx.league.waiverMinBid, ctx.league.waiverHours])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-[11px] text-white/40">
        <HelpCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Changes apply to the canonical league record and save automatically.</span>
        {saving ? <span className="ml-auto text-cyan-300/80">Saving…</span> : null}
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">Waiver type</span>
        <select
          value={waiverType}
          disabled={!canEdit}
          onChange={(e) => {
            const v = e.target.value
            setWaiverType(v)
            queuePatch({ waiverType: v })
          }}
          className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/35 disabled:opacity-50"
        >
          {WAIVER_TYPES.map((o) => (
            <option key={o.value} value={o.value} className="bg-[#0d1117]">
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">FAAB budget</span>
          <input
            type="number"
            min={0}
            max={10000}
            value={waiverBudget}
            disabled={!canEdit}
            onChange={(e) => {
              const v = Number(e.target.value)
              setWaiverBudget(v)
              queuePatch({ waiverBudget: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">Min bid</span>
          <input
            type="number"
            min={0}
            value={waiverMinBid}
            disabled={!canEdit}
            onChange={(e) => {
              const v = Number(e.target.value)
              setWaiverMinBid(v)
              queuePatch({ waiverMinBid: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            Waiver period (hrs)
          </span>
          <input
            type="number"
            min={0}
            max={168}
            value={waiverHours}
            disabled={!canEdit}
            onChange={(e) => {
              const v = Number(e.target.value)
              setWaiverHours(v)
              queuePatch({ waiverHours: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </label>
      </div>
    </div>
  )
}
