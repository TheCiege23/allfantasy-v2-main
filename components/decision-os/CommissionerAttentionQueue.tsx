'use client'
/**
 * Fantasy OS Suite — Phase OS-B2: Decision OS Attention Queue.
 *
 * A reusable, priority-ranked queue of real Decision OS Attention Signals (`DecisionOsAttentionSignal`,
 * `lib/decision-os/attentionSignals.ts`) across every league a commissioner manages. Deliberately
 * generic: `DecisionOsAttentionSignal[]` in, a ranked list out — no page-specific logic, no fetch, no
 * state. This is meant to be the same component a future Notification Engine (Phase OS-B3) reads from,
 * so it takes no dependency on this page's own layout or data-fetching.
 *
 * No fake intelligence: every entry is a real signal Decision OS already derived from real data
 * (league health status, League Context, a real draft date). An empty queue renders a clean, honest
 * empty state, never a placeholder claiming there's nothing to report when the underlying data simply
 * hasn't resolved.
 */
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { AttentionSignalSeverity, DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'
import { DecisionOsPanel, decisionOsSeverityToneClasses } from './DecisionOsCardPrimitives'

type CommissionerAttentionQueueProps = {
  entries: DecisionOsAttentionSignal[]
  leagueNameById: Map<string, string>
  /** Cap how many entries render, independent of how many the API returned. Defaults to all. */
  limit?: number
}

const SEVERITY_ICON_CLASSES: Record<AttentionSignalSeverity, string> = {
  critical: 'text-rose-400',
  high: 'text-orange-400',
  medium: 'text-amber-400',
  low: 'text-sky-400',
  informational: 'text-emerald-400',
}

function SeverityIcon({ severity }: { severity: AttentionSignalSeverity }) {
  const className = `mt-0.5 h-3.5 w-3.5 shrink-0 ${SEVERITY_ICON_CLASSES[severity]}`
  if (severity === 'critical') return <ShieldAlert className={className} aria-hidden />
  if (severity === 'high') return <AlertTriangle className={className} aria-hidden />
  if (severity === 'medium') return <Info className={className} aria-hidden />
  if (severity === 'informational') return <ShieldCheck className={className} aria-hidden />
  return null
}

function formatTimestamp(timestamp: string): string | null {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CommissionerAttentionQueue({ entries, leagueNameById, limit }: CommissionerAttentionQueueProps) {
  const visible = typeof limit === 'number' ? entries.slice(0, limit) : entries

  return (
    <DecisionOsPanel title={visible.length > 0 ? `Attention queue (${visible.length})` : 'Attention queue'}>
      {visible.length === 0 ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted" data-testid="attention-queue-empty">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
          Everything looks healthy today.
        </div>
      ) : (
        <ul className="mt-2 space-y-2" data-testid="attention-queue-list">
          {visible.map((entry) => {
            const formattedTimestamp = formatTimestamp(entry.timestamp)
            return (
              <li
                key={entry.id}
                data-testid={`attention-queue-item-${entry.id}`}
                data-severity={entry.severity}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${decisionOsSeverityToneClasses(entry.severity)}`}
              >
                <SeverityIcon severity={entry.severity} />
                <div className="min-w-0">
                  <p className="font-semibold text-primary">{leagueNameById.get(entry.leagueId) ?? entry.leagueId}</p>
                  <p className="text-xs leading-5 text-secondary">{entry.explanation}</p>
                  {entry.recommendedAction ? (
                    <p className="mt-1 text-xs font-medium leading-5 text-primary">{entry.recommendedAction}</p>
                  ) : null}
                  {formattedTimestamp ? (
                    <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-muted">{formattedTimestamp}</p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </DecisionOsPanel>
  )
}
