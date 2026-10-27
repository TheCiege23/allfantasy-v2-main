'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Switch } from '@/components/ui/switch'
import { ArrowRight, Lock, Shield, UserCog } from 'lucide-react'
import { CommissionerControlPanel } from '@/components/league-settings/CommissionerControlPanel'
import { LineupIntegrity } from '@/components/core-app/commissioner/LineupIntegrity'
import { describeCollusionSensitivity, INTEGRITY_SENSITIVITIES, normalizeSensitivity, type IntegritySensitivity } from '@/lib/integrity/sensitivity'

interface CommissionerToolsTabProps {
  leagueId: string
  hasAfCommissionerSub: boolean
}

function SectionHeader({ icon: Icon, label, locked }: { icon: typeof Shield; label: string; locked?: boolean }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-white/70">
      <Icon className="h-4 w-4" />
      {label}
      {locked ? <Lock className="h-3 w-3 text-amber-400/60" aria-label="AF Commissioner" /> : null}
    </h3>
  )
}

/**
 * Commissioner tab of the Survivor league settings (the only caller: app/survivor/[leagueId]/SurvivorAppShell.tsx).
 *
 * ⚠ THIS TAB USED TO BE A MOCKUP. Every switch was `<Switch defaultChecked={false} />` with no handler
 * (so it could not even flip), every button POSTed to /api/commissioner/leagues/:id, which only
 * accepts PATCH (a silent 405), and the schedule/bracket inputs were never saved. The paid
 * "Competitive Integrity" rows had been locked for everyone until 2026-10 because of a wrong flag; the
 * moment subscribers could reach them, they were five switches that did nothing.
 *
 * Now every control is a real one:
 *  - league controls (lineups, co-commissioners, roster locks, schedule) are the same working panel
 *    League Settings uses;
 *  - anti-tanking and collusion sensitivity read and write LeagueIntegritySettings through
 *    /api/leagues/:id/integrity, which checks the plan and the commissioner itself;
 *  - lineup neglect is the lineup-integrity monitor's report;
 *  - flags are reviewed on the integrity page.
 *  - suspicious trade alerts switch the commissioner's notification for a flagged trade
 *    (lib/integrity/tradeAlerts.ts);
 *  - hold flagged trades sends a flagged trade to commissioner review before it executes
 *    (lib/integrity/holdFlaggedTrades.ts).
 */
export function CommissionerToolsTab({ leagueId, hasAfCommissionerSub }: CommissionerToolsTabProps) {
  return (
    <div className="space-y-6">
      <section>
        <SectionHeader icon={UserCog} label="League controls" />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2">
          <CommissionerControlPanel leagueId={leagueId} />
        </div>
      </section>

      <section data-testid="survivor-integrity-tools">
        <SectionHeader icon={Shield} label="Competitive integrity" locked={!hasAfCommissionerSub} />
        {hasAfCommissionerSub ? (
          <IntegrityControls leagueId={leagueId} />
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-white/70" data-testid="survivor-integrity-locked">
            Anti-tanking detection, collusion checks on every trade and lineup-neglect reports are part of AF Commissioner.{' '}
            <Link href="/commissioner-upgrade" className="font-semibold text-amber-200 underline">Upgrade</Link>
          </div>
        )}
      </section>
    </div>
  )
}

type IntegrityState = {
  tankingMonitorEnabled: boolean
  collusionSensitivity: IntegritySensitivity
  tradeAlertsEnabled: boolean
  holdFlaggedTrades: boolean
}

function IntegrityControls({ leagueId }: { leagueId: string }) {
  const [value, setValue] = useState<IntegrityState | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const url = `/api/leagues/${encodeURIComponent(leagueId)}/integrity`

  useEffect(() => {
    let cancelled = false
    fetch(url, { credentials: 'include', cache: 'no-store' })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok || !d?.settings) {
          setStatus(d?.error ?? 'Could not load the integrity settings.')
          return
        }
        setValue({
          tankingMonitorEnabled: Boolean(d.settings.tankingMonitorEnabled),
          collusionSensitivity: normalizeSensitivity(d.settings.collusionSensitivity),
          tradeAlertsEnabled: d.settings.tradeAlertsEnabled !== false,
          holdFlaggedTrades: d.settings.holdFlaggedTrades === true,
        })
      })
      .catch(() => { if (!cancelled) setStatus('Could not load the integrity settings.') })
    return () => { cancelled = true }
  }, [url])

  const save = async (patch: Partial<IntegrityState>) => {
    if (!value) return
    const previous = value
    setValue({ ...value, ...patch })
    setStatus('Saving…')
    try {
      const r = await fetch(url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      if (!r.ok) throw new Error(String(r.status))
      setStatus('Saved.')
    } catch {
      setValue(previous)
      setStatus('Could not save. Try again.')
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4">
        <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5">
          <div>
            <span className="block text-sm text-white/80">Anti-tanking detection</span>
            <span className="block text-xs text-white/45">Flags a team that benches healthy starters or stops setting lineups.</span>
          </div>
          <Switch
            checked={value?.tankingMonitorEnabled ?? false}
            disabled={!value}
            onCheckedChange={(checked) => void save({ tankingMonitorEnabled: checked })}
            aria-label="Anti-tanking detection"
            data-testid="survivor-integrity-tanking"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5">
          <div>
            <span className="block text-sm text-white/80">Suspicious trade alerts</span>
            <span className="block text-xs text-white/45">Get a notification when the collusion check flags a trade. Off: flags still show on the review page.</span>
          </div>
          <Switch
            checked={value?.tradeAlertsEnabled ?? true}
            disabled={!value}
            onCheckedChange={(checked) => void save({ tradeAlertsEnabled: checked })}
            aria-label="Suspicious trade alerts"
            data-testid="survivor-integrity-trade-alerts"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2.5">
          <div>
            <span className="block text-sm text-white/80">Hold flagged trades</span>
            <span className="block text-xs text-white/45">A trade the collusion check flags waits for you to approve or veto it instead of going through.</span>
          </div>
          <Switch
            checked={value?.holdFlaggedTrades ?? false}
            disabled={!value}
            onCheckedChange={(checked) => void save({ holdFlaggedTrades: checked })}
            aria-label="Hold flagged trades"
            data-testid="survivor-integrity-hold-trades"
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <span className="block text-sm text-white/80">Collusion checks</span>
            <span className="block text-xs text-white/45">
              Every trade is checked. {value ? describeCollusionSensitivity(value.collusionSensitivity) : ''}
            </span>
          </div>
          <select
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-sm text-white"
            value={value?.collusionSensitivity ?? 'medium'}
            disabled={!value}
            onChange={(e) => void save({ collusionSensitivity: e.target.value as IntegritySensitivity })}
            aria-label="Collusion sensitivity"
            data-testid="survivor-integrity-collusion"
          >
            {INTEGRITY_SENSITIVITIES.map((s) => (
              <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>
      {status ? <p role="status" className="text-xs text-white/60">{status}</p> : null}

      <LineupIntegrity leagueId={leagueId} />

      <Link
        href={`/league/${encodeURIComponent(leagueId)}/commissioner/integrity`}
        className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-300 underline"
        data-testid="survivor-integrity-review"
      >
        Review integrity flags <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  )
}
