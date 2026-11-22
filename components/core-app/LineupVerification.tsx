'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { coreTriageMessages } from '@/lib/core-app/messages/coreTriage'
import { myTeamGuideMessages } from '@/lib/core-app/messages/myTeamGuide'
import { verificationAge, type LineupVerification as Verification } from '@/lib/core-app/lineupVerification'

/**
 * When AllFantasy last checked the lineup against the platform.
 *
 * `compact` (My team's team card, 2026-11-14) is one line — "Checked just now with Sleeper · Refresh
 * lineup" — where the card took three: a title, "Starter, bench, IR and taxi placement verified." and
 * "This checks lineup placement. Injury news and projections may update separately."
 */
export function LineupVerification({
  verification,
  compact = false,
  platform = 'Sleeper',
}: {
  verification: Verification | null | undefined
  compact?: boolean
  platform?: string
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [now, setNow] = useState<number | null>(null)
  /* Every sentence here was English under a Spanish screen (language audit, 2026-10-03). */
  const { language } = useOptionalLanguage()
  const m = useMessages(coreTriageMessages)
  const g = useMessages(myTeamGuideMessages)
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [verification?.checkedAt])
  const stale = verification && now != null && now - Date.parse(verification.checkedAt) >= 300000
  const refresh = (
    <button type="button" className={compact ? 'af-lv-refresh-link' : 'af-btn af-lv-refresh'} disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>
      {refreshing ? m.verifyChecking : m.verifyRefresh}
    </button>
  )
  if (compact) {
    return (
      <p className="af-lv-line" role="status" aria-label={m.verifySection} data-testid="my-team-checked">
        {verification ? (
          <>
            <time dateTime={verification.checkedAt} title={verification.checkedAt}>
              {g.checkedWith(now == null ? m.verifyChecked : verificationAge(verification.checkedAt, now, language), platform)}
            </time>
            {stale ? m.verifyStale : null}
          </>
        ) : (
          m.verifyNone
        )}{' '}
        · {refresh}
      </p>
    )
  }
  return <section aria-label={m.verifySection} className="af-frame af-lv">
    <strong className="af-lv-title">Sleeper{verification?.week != null ? ` · ${m.verifyWeek} ${verification.week}` : ''}</strong>
    <p role="status" className="af-lv-status">{verification ? <><time dateTime={verification.checkedAt} title={verification.checkedAt}>{now == null ? m.verifyChecked : verificationAge(verification.checkedAt, now, language)}</time>{stale ? m.verifyStale : m.verifyFresh}</> : m.verifyNone}</p>
    <p className="af-lv-note">{m.verifyNote}</p>
    {refresh}
  </section>
}
