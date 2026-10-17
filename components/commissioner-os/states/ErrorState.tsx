'use client'

import { Button } from '@/components/ui/button'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { shellText } from '@/lib/commissioner-os/i18n/shellCopy'

export interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

/**
 * Calm, never styled like a Critical severity finding (Design Constitution
 * §18) — an error is a technical fact, not a league-health signal, and
 * must never be visually confusable with one.
 *
 * Spanish (2026-10-06): the default message and "Retry" follow the reader's language. A `message`
 * the caller passes is shown as given — each caller translates its own.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const { language } = useOptionalLanguage()
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center" role="alert">
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {message ?? shellText("Couldn't load this right now.", language)}
      </p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          {shellText('Retry', language)}
        </Button>
      )}
    </div>
  )
}
