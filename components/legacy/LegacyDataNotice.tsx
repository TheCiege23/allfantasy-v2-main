'use client'

import type { LegacyDataState, LegacyDataStatus } from '@/lib/legacy/dataStatus'

const TITLE_BY_STATE: Record<LegacyDataState, string> = {
  available: 'Data available',
  partial: 'Some data is missing',
  processing: 'Import in progress',
  stale: 'Data may be outdated',
  unavailable: 'Data unavailable',
  failed: 'We could not load this data',
  not_supported: 'Not supported by this platform',
  auth_required: 'Sign in required',
  link_required: 'Connect your Sleeper account',
}

/** Tone grammar mirrors DataFreshnessBanner / import-health: emerald = fine, amber = caution,
 * red = broken, slate = neutral/informational. */
const TONE_BY_STATE: Record<LegacyDataState, string> = {
  available: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  partial: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  processing: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  stale: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  unavailable: 'border-white/10 bg-white/[0.04] text-white/70',
  failed: 'border-red-500/20 bg-red-500/10 text-red-300',
  not_supported: 'border-white/10 bg-white/[0.04] text-white/70',
  auth_required: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  link_required: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
}

export type LegacyDataNoticeProps = {
  status: LegacyDataStatus
  compact?: boolean
  onRetry?: () => void
  className?: string
}

/** Only https links to external platforms are renderable — `javascript:` or malformed URLs
 * coming through a status object must never become a clickable href. */
function safeExternalUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function formatLastUpdated(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/**
 * The one shared way Legacy surfaces say "here is what we actually know". Replaces silent
 * empty states, fabricated zeros, and swallowed failures. role/aria follow the state:
 * failures are alerts, processing politely announces.
 */
export function LegacyDataNotice({ status, compact = false, onRetry, className }: LegacyDataNoticeProps) {
  const externalUrl = safeExternalUrl(status.externalActionUrl)
  const lastUpdated = status.lastUpdatedAt ? formatLastUpdated(status.lastUpdatedAt) : null
  return (
    <section
      role={status.state === 'failed' ? 'alert' : 'status'}
      aria-live={status.state === 'processing' ? 'polite' : 'off'}
      data-state={status.state}
      className={`rounded-xl border ${TONE_BY_STATE[status.state]} ${compact ? 'px-3 py-2' : 'p-4'} ${className ?? ''}`}
    >
      <div className={compact ? 'flex items-center gap-2 text-xs' : 'space-y-1 text-sm'}>
        <strong className="font-semibold">{TITLE_BY_STATE[status.state]}</strong>
        <p className={compact ? 'truncate text-white/70' : 'text-white/70'}>{status.message}</p>
      </div>

      {!compact && lastUpdated ? (
        <p className="mt-1 text-xs text-white/50">Last updated {lastUpdated}</p>
      ) : null}

      <div className={`flex items-center gap-3 ${compact ? 'mt-1' : 'mt-2'}`}>
        {status.externalActionRequired && externalUrl && status.externalActionLabel ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium underline underline-offset-2 hover:opacity-80"
          >
            {status.externalActionLabel}
          </a>
        ) : null}
        {status.retryable && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
          >
            Try again
          </button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Inline value that never renders a fabricated number: when the value is null/undefined it
 * says so instead of showing 0. Use anywhere a metric used to be `value ?? 0`.
 */
export function LegacyUnavailableValue({
  value,
  label = 'Unavailable',
  format,
}: {
  value: number | string | null | undefined
  label?: string
  format?: (value: number | string) => string
}) {
  if (value === null || value === undefined) {
    return (
      <span className="text-white/40" title={label} aria-label={label}>
        —
      </span>
    )
  }
  return <span>{format ? format(value) : String(value)}</span>
}
