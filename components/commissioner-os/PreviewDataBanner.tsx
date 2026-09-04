import { Info } from 'lucide-react'
import { DATA_MODE_LABELS, type CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'

/**
 * Deliberately unmissable. Text is mode-aware — a hardcoded "stub" mention
 * here would already be wrong now that Demo Mode exists (found and fixed
 * while browser-verifying this exact bug: this banner still said "stub"
 * while showing demo data). Every value on a stub/demo page is fixture
 * data, never a real, computed fact about any real league; this banner
 * exists so that's never mistaken for real intelligence, in a screenshot,
 * a demo, or by a real user.
 */
export function PreviewDataBanner({ mode }: { mode: CommissionerDataMode }) {
  if (mode === 'live') return null

  return (
    <div
      className="mb-4 flex items-center gap-2 rounded-[var(--radius-standard)] border px-3 py-2 text-sm"
      style={{
        background: 'var(--status-information-bg)',
        borderColor: 'var(--status-information-border)',
        color: 'var(--status-information-text)',
      }}
      role="status"
    >
      <Info size={16} aria-hidden />
      <span>
        Preview data — this dashboard is not yet connected to live league intelligence. Every value here is{' '}
        {DATA_MODE_LABELS[mode].toLowerCase()}.
      </span>
    </div>
  )
}
