/**
 * Fantasy OS Suite — Phase V8.5: DemoStateBadge.
 *
 * Renders a Demo Truth Model state truthfully and accessibly. Provider-neutral, white-label-safe (tones
 * route through semantic status tokens), and it never invents freshness — a null freshness is simply not
 * shown. Colour is never the only signal: the label text carries the meaning.
 */
import { describeDemoState, type DemoDataState, type DemoStateTone } from '@/lib/fantasy-os/demoTruthModel'

const TONE_CLASSES: Record<DemoStateTone, string> = {
  success: 'border-status-success/25 bg-status-success/10 text-status-success',
  info: 'border-status-info/25 bg-status-info/10 text-status-info',
  warning: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
  neutral: 'border-subtle bg-surface-muted text-muted',
  danger: 'border-status-danger/25 bg-status-danger/10 text-status-danger',
}

export default function DemoStateBadge({
  state,
  freshness,
  className,
}: {
  state: DemoDataState
  /** Optional human-readable freshness (e.g. from `formatFreshness`). Never invented — omit when unknown. */
  freshness?: string | null
  className?: string
}) {
  const d = describeDemoState(state)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${TONE_CLASSES[d.tone]} ${className ?? ''}`}
      aria-label={`${d.label}. ${d.description}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      <span>{d.label}</span>
      {freshness ? <span className="font-medium opacity-80">· {freshness}</span> : null}
    </span>
  )
}
