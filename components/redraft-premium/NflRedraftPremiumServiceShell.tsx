'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Lock, Loader2 } from 'lucide-react'
import type {
  NflRedraftPremiumProductContractResult,
  NflRedraftPremiumProductPacket,
  NflRedraftPremiumServiceId,
  NflRedraftPremiumServiceVariant,
  NflRedraftPremiumTier,
} from '@/lib/redraft-premium'

export type NflRedraftPremiumServiceShellProps = {
  serviceType: NflRedraftPremiumServiceId
  serviceVariant?: NflRedraftPremiumServiceVariant
  leagueId: string
  teamId?: string | null
  managerId?: string | null
  matchupId?: string | null
  playerId?: string | null
  week?: number | null
  season?: number | null
  requestedTier?: NflRedraftPremiumTier | null
  title?: string
  surfaceLabel?: string
  compact?: boolean
  className?: string
}

type ShellState =
  | { status: 'loading' }
  | { status: 'ready'; packet: NflRedraftPremiumProductPacket }
  | { status: 'error'; message: string }

const SERVICE_FALLBACK_LABELS: Record<NflRedraftPremiumServiceId, string> = {
  basic_runtime_facts: 'Basic Runtime Facts',
  war_room: 'AF Legacy',
  commissioner_digest: 'AF Commissioner Digest',
  manager_brief: 'AF Manager Brief',
  matchup_prep: 'Matchup Prep',
  waiver_report: 'Waiver Report',
  trade_review: 'Trade Review',
  draft_prep: 'Draft Prep',
}

const TIER_LABELS: Record<NflRedraftPremiumTier, string> = {
  FREE: 'Free',
  AF_PRO: 'AF Pro',
  AF_COMMISSIONER: 'AF Commissioner',
  AF_SUPREME: 'AF Supreme',
  AF_WAR_ROOM: 'AF Legacy',
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function compactText(value: string): string {
  return value
    .replace(/[_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tierLabel(tier: NflRedraftPremiumTier | null | undefined): string {
  return tier ? TIER_LABELS[tier] : 'Free'
}

function buildRequestBody(props: NflRedraftPremiumServiceShellProps): Record<string, string | number> {
  const body: Record<string, string | number> = {
    serviceType: props.serviceType,
    leagueId: props.leagueId,
  }

  if (props.serviceVariant) body.serviceVariant = props.serviceVariant
  if (props.teamId) body.teamId = props.teamId
  if (props.managerId) body.managerId = props.managerId
  if (props.matchupId) body.matchupId = props.matchupId
  if (props.playerId) body.playerId = props.playerId
  if (props.week) body.week = props.week
  if (props.season) body.season = props.season
  if (props.requestedTier) body.requestedTier = props.requestedTier

  return body
}

function WarningList({
  label,
  values,
  tone = 'amber',
}: {
  label: string
  values: string[]
  tone?: 'amber' | 'sky' | 'rose'
}) {
  if (values.length === 0) return null
  return (
    <div className="space-y-1" data-testid={`premium-service-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <p
        className={cx(
          'text-[11px] font-semibold uppercase tracking-wide',
          tone === 'rose' ? 'text-rose-200/80' : tone === 'sky' ? 'text-sky-200/80' : 'text-amber-200/80',
        )}
      >
        {label}
      </p>
      <ul className="space-y-1">
        {values.map((value) => (
          <li key={value} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/70">
            {compactText(value)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChipList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span key={value} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white/70">
            {compactText(value)}
          </span>
        ))}
      </div>
    </div>
  )
}

function LoadingShell({ title }: { title: string }) {
  return (
    <div className="flex min-h-[120px] items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4" data-testid="premium-service-loading">
      <Loader2 className="h-4 w-4 animate-spin text-cyan-200" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-white/55">Loading service packet</p>
      </div>
    </div>
  )
}

function ErrorShell({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-rose-300/20 bg-rose-500/10 p-4" data-testid="premium-service-error">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-200" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-rose-100/80">{message || 'Service packet unavailable.'}</p>
        </div>
      </div>
    </div>
  )
}

function ReadyShell({
  packet,
  title,
  surfaceLabel,
  compact,
}: {
  packet: NflRedraftPremiumProductPacket
  title: string
  surfaceLabel?: string
  compact?: boolean
}) {
  const allowed = packet.accessStatus.allowed
  const emptyEvidence = packet.evidencePacketIds.length === 0 || packet.evidenceCounts.selected === 0 || packet.resolverStatus.status === 'empty'
  const statusLabel = allowed ? 'Access available' : `Requires ${tierLabel(packet.requiredTier)}`
  const warningCount =
    packet.staleDataWarnings.length +
    packet.fallbackWarnings.length +
    packet.missingDataWarnings.length +
    packet.unavailableDataMessages.length

  return (
    <div className="rounded-lg border border-white/10 bg-[#101522] p-4 shadow-sm" data-testid={allowed ? 'premium-service-allowed' : 'premium-service-locked'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">{title}</p>
            {surfaceLabel ? (
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/55">
                {surfaceLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-white/55">
            {packet.serviceName} - {tierLabel(packet.requiredTier)}
          </p>
        </div>
        <div
          className={cx(
            'inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold',
            allowed
              ? 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
              : 'border-amber-300/25 bg-amber-500/10 text-amber-100',
          )}
        >
          {allowed ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
          {statusLabel}
        </div>
      </div>

      {!allowed ? (
        <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-50/80">
          {tierLabel(packet.requiredTier)} is needed for this service.
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Evidence Count</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-white">{packet.evidenceCounts.selected}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Freshness</p>
          <p className="mt-1 text-sm font-semibold text-white">{compactText(packet.freshnessWarnings.overall)}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">Warnings</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-white">{warningCount}</p>
        </div>
      </div>

      {emptyEvidence ? (
        <p className="mt-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60" data-testid="premium-service-empty">
          No canonical evidence is available for this request yet.
        </p>
      ) : null}

      <div className={cx('mt-4 grid gap-3', compact ? '' : 'lg:grid-cols-2')}>
        <WarningList label="Stale Data" values={packet.staleDataWarnings} tone="amber" />
        <WarningList label="Fallback Data" values={packet.fallbackWarnings} tone="sky" />
        <WarningList label="Missing Data" values={packet.missingDataWarnings} tone="rose" />
        <WarningList label="Unavailable Data" values={packet.unavailableDataMessages} tone="amber" />
        <ChipList label="Eligible Surfaces" values={packet.eligibleSurfaces} />
        <ChipList label="Fact Categories" values={packet.factualCategoryLabels} />
      </div>
    </div>
  )
}

export function NflRedraftPremiumServiceShell({
  serviceType,
  serviceVariant,
  leagueId,
  teamId,
  managerId,
  matchupId,
  playerId,
  week,
  season,
  requestedTier,
  title: titleProp,
  surfaceLabel,
  compact,
  className,
}: NflRedraftPremiumServiceShellProps) {
  const title = titleProp ?? SERVICE_FALLBACK_LABELS[serviceType]
  const requestBody = useMemo(
    () =>
      buildRequestBody({
        serviceType,
        serviceVariant,
        leagueId,
        teamId,
        managerId,
        matchupId,
        playerId,
        week,
        season,
        requestedTier,
      }),
    [
      leagueId,
      managerId,
      matchupId,
      playerId,
      requestedTier,
      season,
      serviceType,
      serviceVariant,
      teamId,
      week,
    ],
  )
  const [state, setState] = useState<ShellState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })

    fetch('/api/redraft/premium-services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
      .then(async (response) => {
        const result = (await response.json()) as NflRedraftPremiumProductContractResult
        if (!active) return
        if (!response.ok || !result.ok) {
          setState({ status: 'error', message: !result.ok ? result.error.message : 'Service packet unavailable.' })
          return
        }
        setState({ status: 'ready', packet: result })
      })
      .catch(() => {
        if (active) setState({ status: 'error', message: 'Service packet unavailable.' })
      })

    return () => {
      active = false
    }
  }, [requestBody])

  return (
    <section className={cx('w-full', className)} data-testid="premium-service-shell" data-service={serviceType}>
      {state.status === 'loading' ? <LoadingShell title={title} /> : null}
      {state.status === 'error' ? <ErrorShell title={title} message={state.message} /> : null}
      {state.status === 'ready' ? (
        <ReadyShell packet={state.packet} title={title} surfaceLabel={surfaceLabel} compact={compact} />
      ) : null}
    </section>
  )
}
