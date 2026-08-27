'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { WizardSetupSource } from '@/lib/league-creation-wizard/types'
import { StepHeader } from './StepHelp'
import { resolvesToLeagueRecord, type LeagueRecordPolicyInput } from '@/lib/dashboard/league-card-fetch-policy'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type LeagueListRow = LeagueRecordPolicyInput & {
  id: string
  name?: string | null
  sport?: string | null
  leagueSize?: number | null
  settings?: unknown
}

export type LeagueSourceSectionProps = {
  setupSource: WizardSetupSource
  copyFromLeagueId: string | null
  currentSport: string
  onSetupSourceChange: (source: WizardSetupSource) => void
  onCopyLeagueApply: (league: LeagueListRow) => void
}

/**
 * Starting point: new league, clone another AllFantasy league, or use the import site for synced leagues.
 */
export function LeagueSourceSection({
  setupSource,
  copyFromLeagueId,
  currentSport,
  onSetupSourceChange,
  onCopyLeagueApply,
}: LeagueSourceSectionProps) {
  const [rows, setRows] = useState<LeagueListRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (setupSource !== 'copy_league') return
    setLoading(true)
    fetch('/api/league/list', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data?.leagues) ? data.leagues : []
        setRows(
          list.map((lg: Record<string, unknown>) => ({
            id: String(lg.id ?? ''),
            name: (lg.name as string) ?? null,
            sport: (lg.sport as string) ?? (lg.sport_type as string) ?? null,
            leagueSize: typeof lg.leagueSize === 'number' ? lg.leagueSize : typeof lg.teamCount === 'number' ? lg.teamCount : null,
            settings: lg.settings,
          }))
          /*
           * ⚠ A tournament hub is not a league you can source a new league FROM — its id is a
           * `LegacyTournament` key, and every read behind this step goes to `leagues`. AF Legacy
           * board rows are the same story. `hasUnifiedRecord` is the wrong test for the first of
           * those (tournament rows set it true); `resolvesToLeagueRecord` covers both.
           */
          .filter((x: LeagueListRow) => x.id && resolvesToLeagueRecord(x as LeagueRecordPolicyInput))
        )
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [setupSource])

  const sameSportRows = rows.filter((r) => !r.sport || String(r.sport).toUpperCase() === currentSport.toUpperCase())

  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-black/25 p-4">
      <StepHeader
        title="Where should we start?"
        description="Build from scratch, mirror another league you run on AllFantasy, or import a synced league from Sleeper, ESPN, or Yahoo on the import page."
        help={
          <>
            Copying applies saved rules from that league as a starting point. You still confirm every setting before
            creation. Full cross-site imports use the dedicated import flow so data stays accurate.
          </>
        }
        helpTitle="League source"
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(
          [
            { id: 'fresh' as const, title: 'New league', sub: 'Defaults for your sport' },
            { id: 'copy_league' as const, title: 'Copy AF league', sub: 'Reuse settings you like' },
            { id: 'external_guide' as const, title: 'Import site', sub: 'Sleeper · ESPN · Yahoo · more' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSetupSourceChange(opt.id)}
            className={`rounded-xl border px-3 py-3 text-left transition ${
              setupSource === opt.id
                ? 'border-cyan-400/50 bg-cyan-500/10 text-white shadow-[0_0_0_1px_rgba(34,211,238,0.2)_inset]'
                : 'border-white/10 bg-white/[0.03] text-white/85 hover:bg-white/[0.06]'
            }`}
          >
            <div className="text-sm font-bold">{opt.title}</div>
            <div className="mt-0.5 text-[11px] text-white/50">{opt.sub}</div>
          </button>
        ))}
      </div>

      {setupSource === 'copy_league' && (
        <div className="space-y-2">
          <Label className="text-cyan-200/90">League to mirror</Label>
          {loading ? (
            <p className="text-xs text-white/50" role="status">
              Loading your leagues…
            </p>
          ) : sameSportRows.length === 0 ? (
            <p className="text-xs text-amber-200/90">
              No {currentSport} leagues found. Create one first or pick another sport.
            </p>
          ) : (
            <Select
              value={copyFromLeagueId ?? ''}
              onValueChange={(id) => {
                const league = sameSportRows.find((r) => r.id === id)
                if (league) onCopyLeagueApply(league)
              }}
            >
              <SelectTrigger className="min-h-[44px] border-white/20 bg-[#030a20] text-white">
                <SelectValue placeholder="Choose a league" />
              </SelectTrigger>
              <SelectContent>
                {sameSportRows.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name?.trim() || 'Untitled'} ({r.sport ?? currentSport})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-[11px] text-white/45">
            We&apos;ll pre-fill rules from that league&apos;s saved settings. You&apos;ll still review everything in the next steps.
          </p>
        </div>
      )}

      {setupSource === 'external_guide' && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-3 text-sm text-white/80">
          <p className="font-medium text-cyan-100">Import from another host</p>
          <p className="mt-1 text-xs text-white/55">
            Use the import page to connect Sleeper, ESPN, Yahoo, Fantrax, MFL, or Fleaflicker. After import, your league
            appears in the app with live sync.
          </p>
          <Link
            href="/import?returnTo=%2Fcreate-league"
            className="mt-2 inline-flex text-sm font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline"
          >
            Open import page →
          </Link>
        </div>
      )}
    </section>
  )
}
