'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { getZombieSportConfig } from '@/lib/zombie/sportRulesConfig'

type ResolutionRow = {
  id: string
  week: number
  status: string
  resolvedAt: string | null
  hordeSize: number | null
  survivorCount: number | null
  infectionsThisWeek: number | null
}

type LeagueInfo = {
  status: string
  currentWeek: number
  sport: string
  isPaid: boolean
  weeklyUpdateAutoPost: boolean
  weeklyUpdateApproval: boolean
  weeklyUpdateDay: number | null
  weeklyUpdateHour: number | null
}

const PIPELINE_STEPS = [
  { id: 'matchup_resolution', label: 'Matchup Resolution', icon: '📊', description: 'Score finalization and winner determination' },
  { id: 'infection_check', label: 'Infection Check', icon: '🧟', description: 'Determine new infections from Zombie/Whisperer wins' },
  { id: 'bashing_mauling', label: 'Bashing & Mauling', icon: '🔥', description: 'Evaluate margin thresholds for combat events' },
  { id: 'serum_awards', label: 'Serum Awards', icon: '🧪', description: 'Award serums to qualifying survivors' },
  { id: 'weapon_awards', label: 'Weapon Awards', icon: '⚔️', description: 'Award weapons based on score thresholds' },
  { id: 'winnings_transfer', label: 'Winnings Transfer', icon: '💰', description: 'Transfer pot shares / points based on outcomes' },
  { id: 'status_changes', label: 'Status Changes', icon: '🔄', description: 'Apply all infection/revival status changes' },
  { id: 'animation_queue', label: 'Animation Queue', icon: '🎬', description: 'Queue event animations for the client' },
  { id: 'weekly_update', label: 'Weekly Update', icon: '📝', description: 'Generate and optionally post weekly report' },
  { id: 'universe_sync', label: 'Universe Sync', icon: '🌍', description: 'Update universe standings and projections' },
  { id: 'audit_log', label: 'Audit Logging', icon: '📋', description: 'Record all events in permanent audit trail' },
  { id: 'notifications', label: 'Notifications', icon: '🔔', description: 'Send commissioner and player notifications' },
]

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ZombieAutomationPanel({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [league, setLeague] = useState<LeagueInfo | null>(null)
  const [resolutions, setResolutions] = useState<ResolutionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { league?: LeagueInfo; resolutions?: ResolutionRow[] } | null) => {
        if (d?.league) setLeague(d.league)
        if (d?.resolutions) setResolutions(d.resolutions)
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [leagueId])

  if (loading || !league) {
    return (
      <div className="flex min-h-[200px] items-center justify-center px-6 py-6">
        <p className="text-[12px] text-[var(--zombie-text-dim)]">Loading automation status...</p>
      </div>
    )
  }

  const cfg = getZombieSportConfig(league.sport)
  const latestResolution = resolutions[0]
  const isResolved = latestResolution?.status === 'complete'

  return (
    <div className="px-6 py-5 text-[13px] text-white/85">
      {/* Status overview */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatusCard
          label="League Status"
          value={league.status.toUpperCase()}
          color={league.status === 'active' ? 'var(--zombie-green)' : 'var(--zombie-gold)'}
          icon="🏟️"
        />
        <StatusCard
          label="Current Week"
          value={String(league.currentWeek)}
          color="white"
          icon="📅"
        />
        <StatusCard
          label="Resolution"
          value={isResolved ? 'COMPLETE' : 'PENDING'}
          color={isResolved ? 'var(--zombie-green)' : 'var(--zombie-gold)'}
          icon={isResolved ? '✅' : '⏳'}
        />
      </div>

      {/* Sport config */}
      <section className="mb-5 rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--zombie-text-dim)]">
          {cfg.label} Automation Config
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <span className="text-[var(--zombie-text-dim)]">Resolution day:</span>{' '}
            <span className="text-white/80">{cfg.resolutionDay}</span>
          </div>
          <div>
            <span className="text-[var(--zombie-text-dim)]">Ambush deadline:</span>{' '}
            <span className="text-white/80">{cfg.ambushDeadline}</span>
          </div>
          <div>
            <span className="text-[var(--zombie-text-dim)]">Scoring type:</span>{' '}
            <span className="text-white/80 capitalize">{cfg.scoringType}</span>
          </div>
          <div>
            <span className="text-[var(--zombie-text-dim)]">Lineup frequency:</span>{' '}
            <span className="text-white/80 capitalize">{cfg.lineupFrequency}</span>
          </div>
          <div>
            <span className="text-[var(--zombie-text-dim)]">Update schedule:</span>{' '}
            <span className="text-white/80">
              {league.weeklyUpdateDay != null
                ? `${DAY_NAMES[league.weeklyUpdateDay]} at ${league.weeklyUpdateHour ?? 9}:00 UTC`
                : 'After resolution'}
            </span>
          </div>
          <div>
            <span className="text-[var(--zombie-text-dim)]">Auto-post:</span>{' '}
            <span className={league.weeklyUpdateAutoPost ? 'text-[var(--zombie-green)]' : 'text-[var(--zombie-text-dim)]'}>
              {league.weeklyUpdateAutoPost ? 'ON' : 'OFF'}
            </span>
            {league.weeklyUpdateApproval && (
              <span className="ml-2 text-amber-300">(approval required)</span>
            )}
          </div>
        </div>
      </section>

      {/* Automation pipeline */}
      <section className="mb-5">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[var(--zombie-text-dim)]">
          Weekly Automation Pipeline
        </p>
        <p className="mb-3 text-[11px] text-[var(--zombie-text-mid)]">
          This sequence runs automatically after each scoring period resolves.
        </p>
        <div className="space-y-1">
          {PIPELINE_STEPS.map((step, i) => (
            <div
              key={step.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-4 py-2.5"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-bold text-[var(--zombie-text-dim)]">
                {i + 1}
              </span>
              <span className="text-lg">{step.icon}</span>
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-[var(--zombie-text-full)]">{step.label}</p>
                <p className="text-[11px] text-[var(--zombie-text-mid)]">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Resolution history */}
      <section>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-[var(--zombie-text-dim)]">
          Resolution History
        </p>
        {resolutions.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-[var(--zombie-border)]">
            <table className="w-full text-left text-[12px]">
              <thead className="border-b border-[var(--zombie-border)] text-[11px] uppercase text-[var(--zombie-text-dim)]">
                <tr>
                  <th className="p-2.5">Week</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Horde</th>
                  <th className="p-2.5">Survivors</th>
                  <th className="p-2.5">New Infections</th>
                  <th className="p-2.5">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {resolutions.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.04]">
                    <td className="p-2.5 font-bold">{r.week}</td>
                    <td className="p-2.5">
                      <span
                        className={clsx(
                          'rounded px-1.5 py-0.5 text-[11px] font-bold',
                          r.status === 'complete'
                            ? 'bg-[var(--zombie-green)]/15 text-[var(--zombie-green)]'
                            : 'bg-amber-500/15 text-amber-300',
                        )}
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2.5 text-[var(--zombie-purple)]">{r.hordeSize ?? '—'}</td>
                    <td className="p-2.5 text-[var(--zombie-green)]">{r.survivorCount ?? '—'}</td>
                    <td className="p-2.5">{r.infectionsThisWeek ?? '—'}</td>
                    <td className="p-2.5 text-[var(--zombie-text-dim)]">
                      {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--zombie-text-dim)]">No resolutions recorded yet.</p>
        )}
      </section>
    </div>
  )
}

function StatusCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div className="rounded-xl border border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <div>
          <p className="text-[11px] text-[var(--zombie-text-dim)]">{label}</p>
          <p className="text-[16px] font-black" style={{ color }}>{value}</p>
        </div>
      </div>
    </div>
  )
}
