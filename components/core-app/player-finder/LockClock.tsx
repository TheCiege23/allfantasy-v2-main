'use client'

import { useEffect, useState } from 'react'
import { lockState } from '@/lib/core-app/lineupLock'

/**
 * A lineup-lock countdown that ticks. Paints from the server's clock (`nowIso`)
 * so the hydration matches, then re-reads the browser's clock every 30s — on a
 * game-day screen left open, "locks in 42 min" must not still say 42.
 */
export function LockClock({ kickoffIso, nowIso, big = false }: { kickoffIso: string; nowIso: string; big?: boolean }) {
  const [now, setNow] = useState(nowIso)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 30_000)
    return () => clearInterval(t)
  }, [])
  const s = lockState(kickoffIso, now)
  // The row chip stays short once locked — the kickoff is in the tooltip and on the banner; a long chip pushed the table past the card.
  const text = !big && s.state === 'locked' ? 'locked' : s.label
  return (
    <span className={big ? 'af-num af-pf-lock-big' : 'af-chip af-num af-pf-lock'} data-lock={s.state} title={s.state === 'locked' ? `Locked · kicked off ${s.clock}` : `Lineup locks at his kickoff · ${s.clock}`}>
      {text}
    </span>
  )
}

export default LockClock
