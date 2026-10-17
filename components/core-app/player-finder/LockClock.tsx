'use client'

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { lockState } from '@/lib/core-app/lineupLock'

/**
 * A lineup-lock countdown that ticks. Paints from the server's clock (`nowIso`)
 * so the hydration matches, then re-reads the browser's clock every 30s — on a
 * game-day screen left open, "locks in 42 min" must not still say 42.
 *
 * Spanish (2026-10-04): `lockState`'s English label goes through `coreUiCopy`'s lock patterns — the
 * same ones Game Plan uses — and the bare kickoff clock through `kickoffText`. The provider starts at
 * English on server and client alike, so the first paint still agrees.
 */
export function LockClock({ kickoffIso, nowIso, big = false }: { kickoffIso: string; nowIso: string; big?: boolean }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const [now, setNow] = useState(nowIso)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 30_000)
    return () => clearInterval(t)
  }, [])
  const s = lockState(kickoffIso, now)
  const clock = kickoffText(s.clock, language)
  // The row chip stays short once locked — the kickoff is in the tooltip and on the banner; a long chip pushed the table past the card.
  const text = !big && s.state === 'locked' ? (es ? 'bloqueado' : 'locked') : coreUiCopy(s.label, language)
  const title =
    s.state === 'locked'
      ? es
        ? `Bloqueado · empezó ${clock}`
        : `Locked · kicked off ${s.clock}`
      : es
        ? `La alineación se bloquea en su inicio · ${clock}`
        : `Lineup locks at his kickoff · ${s.clock}`
  return (
    <span className={big ? 'af-num af-pf-lock-big' : 'af-chip af-num af-pf-lock'} data-lock={s.state} title={title}>
      {text}
    </span>
  )
}

export default LockClock
