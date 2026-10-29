'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { coreTriageMessages } from '@/lib/core-app/messages/coreTriage'
import { verificationAge, type LineupVerification as Verification } from '@/lib/core-app/lineupVerification'

export function LineupVerification({ verification }: { verification: Verification | null | undefined }) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [now, setNow] = useState<number | null>(null)
  /* Every sentence here was English under a Spanish screen (language audit, 2026-10-03). */
  const es = useOptionalLanguage().language === 'es'
  const m = useMessages(coreTriageMessages)
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [verification?.checkedAt])
  const stale = verification && now != null && now - Date.parse(verification.checkedAt) >= 300000
  return <section aria-label={m.verifySection} className="af-frame af-lv">
    <strong className="af-lv-title">Sleeper{verification?.week != null ? ` · ${m.verifyWeek} ${verification.week}` : ''}</strong>
    <p role="status" className="af-lv-status">{verification ? <><time dateTime={verification.checkedAt} title={verification.checkedAt}>{now == null ? m.verifyChecked : verificationAge(verification.checkedAt, now, es ? 'es' : 'en')}</time>{stale ? m.verifyStale : m.verifyFresh}</> : m.verifyNone}</p>
    <p className="af-lv-note">{m.verifyNote}</p>
    <button type="button" className="af-btn af-lv-refresh" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? m.verifyChecking : m.verifyRefresh}</button>
  </section>
}
