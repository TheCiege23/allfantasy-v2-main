'use client'

import { Info } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { previewBannerText, shellText } from '@/lib/commissioner-os/i18n/shellCopy'
import { DATA_MODE_LABELS, type CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'

/**
 * Deliberately unmissable. Text is mode-aware — a hardcoded "stub" mention
 * here would already be wrong now that Demo Mode exists (found and fixed
 * while browser-verifying this exact bug: this banner still said "stub"
 * while showing demo data). Every value on a stub/demo page is fixture
 * data, never a real, computed fact about any real league; this banner
 * exists so that's never mistaken for real intelligence, in a screenshot,
 * a demo, or by a real user.
 *
 * Spanish (2026-10-06): the sentence comes from `previewBannerText`; the English is unchanged.
 */
export function PreviewDataBanner({ mode }: { mode: CommissionerDataMode }) {
  const { language } = useOptionalLanguage()
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
      <span>{previewBannerText(shellText(DATA_MODE_LABELS[mode], language), language)}</span>
    </div>
  )
}
