'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

/**
 * Integrity in League Settings: a summary and a way in, not a second editor.
 *
 * ⚠ THIS WAS A FULL COPY OF THE INTEGRITY SETTINGS. Collusion sensitivity, trade alerts, hold mode, the
 * tanking monitor and its checks all lived both here and on the integrity page's rail, and the tanking
 * PENALTIES lived only here — so a commissioner turning the monitor on, on the integrity page, never saw
 * what a confirmed case would cost. Every integrity setting is now edited in one place, beside the
 * flags it governs (owner decision 2026-11-06). This card says what is set and links there.
 */

type Summary = {
  settings: {
    tankingMonitorEnabled: boolean
    tankingPenalties?: { enabled: boolean; penalty?: 'forfeit_pick' | 'lottery_odds' | 'faab' }
  }
  stats: { openCollusion: number; openTanking: number }
}

const PENALTY_LABEL: Record<string, string> = {
  forfeit_pick: 'lose a draft pick',
  lottery_odds: 'worse rookie-lottery odds',
  faab: 'lose FAAB',
}

export function IntegritySettingsPanel(props: { leagueId: string; hasAccess: boolean; upgradeUrl?: string }) {
  const { leagueId, hasAccess, upgradeUrl = '/commissioner-upgrade?highlight=integrity_monitoring' } = props
  const [data, setData] = useState<Summary | null>(null)

  const load = useCallback(async () => {
    if (!hasAccess) return
    const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/integrity`, { cache: 'no-store' }).catch(() => null)
    const json = res && res.ok ? ((await res.json().catch(() => null)) as Summary | null) : null
    setData(json)
  }, [hasAccess, leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const href = `/league/${leagueId}/commissioner/integrity`

  if (!hasAccess) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0a1328] p-4 mt-4">
        <h4 className="text-sm font-bold text-white">🔍 Integrity Monitoring</h4>
        <p className="mt-1 text-xs text-white/50">
          Automatically detect collusion and tanking. Requires AF Commissioner subscription.
        </p>
        <Link
          href={upgradeUrl}
          className="mt-3 inline-flex rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/15"
        >
          Upgrade to AF Commissioner →
        </Link>
      </div>
    )
  }

  const s = data?.settings
  const pen = s?.tankingPenalties
  const tanking = !s
    ? null
    : !s.tankingMonitorEnabled
      ? 'Tanking monitor: off'
      : pen && pen.enabled
        ? `Tanking monitor: on · confirmed cases ${PENALTY_LABEL[pen.penalty ?? 'forfeit_pick']}`
        : 'Tanking monitor: on · no penalties'

  return (
    <div className="rounded-xl border border-cyan-500/15 bg-[#081226] p-4 mt-4" data-testid="integrity-settings-panel">
      <h4 className="text-sm font-bold text-white">🔍 Integrity Monitoring</h4>
      {data && (data.stats.openCollusion > 0 || data.stats.openTanking > 0) ? (
        <p className="mt-1 text-[11px] text-amber-200/90">
          {data.stats.openCollusion} open collusion · {data.stats.openTanking} open tanking
        </p>
      ) : null}
      <p className="mt-2 text-xs text-white/60">
        Collusion monitor: always on{tanking ? ` · ${tanking}` : ''}
      </p>
      <p className="mt-1 text-[11px] text-white/45">
        Sensitivity, alerts, held trades and tanking penalties are all set on the integrity page, beside the flags.
      </p>
      <Link
        href={href}
        data-testid="integrity-settings-link"
        className="mt-3 inline-flex rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/15"
      >
        Open integrity settings →
      </Link>
    </div>
  )
}
