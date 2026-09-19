'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { verificationAge, type LineupVerification as Verification } from '@/lib/core-app/lineupVerification'

export function LineupVerification({ verification }: { verification: Verification | null | undefined }) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [verification?.checkedAt])
  const stale = verification && now != null && now - Date.parse(verification.checkedAt) >= 300000
  return <section aria-label="Lineup verification" className="af-frame" style={{ padding: 16, marginBottom: 16 }}>
    <strong>Sleeper{verification?.week != null ? ` · Week ${verification.week}` : ''}</strong>
    <p role="status">{verification ? <><time dateTime={verification.checkedAt} title={verification.checkedAt}>{now == null ? 'Lineup checked' : verificationAge(verification.checkedAt, now)}</time>{stale ? ' · Refresh before making a lineup decision.' : ' · Starter, bench, IR and taxi placement verified.'}</> : 'Lineup could not be verified. Lineup advice is paused until a successful refresh.'}</p>
    <p style={{ fontSize: 12 }}>This checks lineup placement. Injury news and projections may update separately.</p>
    <button type="button" className="af-btn" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}>{refreshing ? 'Checking Sleeper…' : 'Refresh lineup'}</button>
  </section>
}
