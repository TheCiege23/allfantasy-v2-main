'use client'

import Link from 'next/link'
import { Trophy, Import, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { consumeDashboardRankRefreshPending } from '@/lib/import/dashboardRankRefresh'

type LegacySnapshotCardProps = {
  rankPayload: Record<string, unknown> | null | undefined
}

/**
 * Phase 4.3 Rankings UI — Dashboard V2 upgrade for the LegacySnapshot dashboard
 * widget. Applies warroom-card depth + fade-in-stagger entrance, color-grammar
 * tones (Trophy amber = career achievement, Recommend emerald = XP/progress)
 * and an HONEST empty state that references the Phase 3.1 wiring: importing a
 * Sleeper league populates the rank domain, so an unimported profile shows
 * "Import to unlock" not just "—".
 *
 * A 4th "Archetype" tile previously existed here but always rendered "—" —
 * no `managerArchetype`/`archetype` field has ever existed anywhere in the
 * rank payload or the scoring lib (confirmed audit finding). Removed rather
 * than left showing a permanent placeholder.
 *
 * Also surfaces a subtle "recently refreshed" indicator when a completed import
 * fired `markDashboardRankRefreshPending()` in the same session — the visible
 * proof of the import→rank bridge landing on the dashboard.
 */
export function LegacySnapshotCard({ rankPayload }: LegacySnapshotCardProps) {
  const [justRefreshed, setJustRefreshed] = useState(false)

  useEffect(() => {
    if (consumeDashboardRankRefreshPending()) {
      setJustRefreshed(true)
      const t = setTimeout(() => setJustRefreshed(false), 8000)
      return () => clearTimeout(t)
    }
    return
  }, [])

  // `/api/user/rank` has no top-level scalar `rank`/`overallRank` field — those never
  // existed, so this tile always rendered "—" (or "[object Object]" once `rank` here
  // shadowed the API's *nested* `rank` object). The real rank title lives at
  // `levelName`/`tierName` (both `lv.name` from lib/rank/levels.ts, e.g. "Grizzled Vet"),
  // with `rank.careerTierName` as a fallback for older cached payload shapes.
  const rankObj = rankPayload?.rank as Record<string, unknown> | null | undefined
  const rank = rankPayload?.levelName ?? rankPayload?.tierName ?? rankObj?.careerTierName ?? null
  const tier = rankPayload?.tier ?? rankObj?.careerTier ?? null
  const xp = rankPayload?.xpTotal ?? rankPayload?.xp ?? rankPayload?.totalXp ?? null
  const imported = Boolean(rankPayload?.imported)

  const hasAnyValue = rank != null || tier != null || xp != null

  return (
    <section
      data-testid="legacy-snapshot-card"
      className="warroom-card warroom-fade-in-stagger rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" />
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-amber-400/80">
            Legacy Snapshot
          </p>
          {justRefreshed ? (
            <span
              data-testid="rank-refreshed-indicator"
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/[0.10] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-300"
              role="status"
              aria-label="Rank data just refreshed after import"
            >
              <TrendingUp className="h-2.5 w-2.5" aria-hidden />
              Just refreshed
            </span>
          ) : null}
        </div>
        <Link
          href="/af-rankings"
          className="warroom-pressable text-[11px] font-black uppercase tracking-wider text-amber-400/60 hover:text-amber-300"
        >
          Full legacy →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="AF Rank" value={rank != null ? String(rank) : '—'} tone="amber" testid="legacy-stat-rank" />
        <StatTile label="Tier" value={tier != null ? String(tier) : '—'} tone="neutral" size="sm" testid="legacy-stat-tier" />
        <StatTile label="XP" value={xp != null ? String(xp) : '—'} tone="emerald" size="sm" testid="legacy-stat-xp" />
      </div>

      {/* Honest empty-state: match the audit's finding that career-rank/legacy-XP
          is fed via the import pipeline, so surface a real CTA when no data yet. */}
      {!hasAnyValue && !imported ? (
        <Link
          href="/import"
          data-testid="legacy-snapshot-import-cta"
          className="warroom-pressable mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.08] px-3 py-2 text-[12px] font-black text-cyan-200 hover:border-cyan-400/50 hover:bg-cyan-500/[0.14]"
        >
          <Import className="h-3.5 w-3.5" aria-hidden />
          Import a Sleeper league to unlock your legacy profile
        </Link>
      ) : (
        <p className="mt-3 text-[11px] leading-snug text-white/35">
          Rankings refresh when a Sleeper league import completes — see{' '}
          <Link href="/import" className="text-cyan-400/80 underline hover:text-cyan-300">
            import history
          </Link>
          .
        </p>
      )}
    </section>
  )
}

const TONE_CLASSES: Record<'amber' | 'emerald' | 'blue' | 'neutral', string> = {
  amber: 'text-amber-300',
  emerald: 'text-emerald-300',
  blue: 'text-blue-300',
  neutral: 'text-white/80',
}

function StatTile({
  label,
  value,
  tone,
  size = 'md',
  testid,
}: {
  label: string
  value: string
  tone: 'amber' | 'emerald' | 'blue' | 'neutral'
  size?: 'sm' | 'md'
  testid?: string
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5"
    >
      <p className="text-[10px] font-black uppercase tracking-wider text-white/40">{label}</p>
      <p className={`mt-1 font-black tabular-nums ${size === 'md' ? 'text-lg' : 'text-sm'} ${TONE_CLASSES[tone]}`}>
        {value}
      </p>
    </div>
  )
}
