'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useTradeDeadlineCountdownText } from '@/components/core-app/TradeDeadlineCountdown'
import { redraftDeadlineBar, redraftShellSportOf, type SnapshotDeadline } from '@/lib/core-app/redraftCoreTrades'
import type { TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'
import '@/components/core-app/af-core-redraft-trades.css'

/* Layout effect on the client (no flash of the old row after hydration), plain effect on the server. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * The redraft sport of the /core shell this component sits in, or null. Starts null (the server and
 * the first client render agree), then reads the shell's stamp before the browser paints.
 */
export function useRedraftShellSport(): { ref: React.RefObject<HTMLSpanElement | null>; sport: string | null; decided: boolean } {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [state, setState] = useState<{ sport: string | null; decided: boolean }>({ sport: null, decided: false })
  useIsoLayoutEffect(() => {
    setState({ sport: redraftShellSportOf(ref.current), decided: true })
  }, [])
  return { ref, ...state }
}

/**
 * The redraft trade-deadline bar (batch B4): weeks left / deadline week / passed / "No trade deadline",
 * from the server's verdict (`deadlineCountdown`), falling back to the import snapshot. Renders NOTHING
 * outside a redraft /core shell and nothing when the data says nothing (`redraftDeadlineBar` → null),
 * so `fallback` — the screen's own deadline row — is what every other league keeps.
 */
export function RedraftTradeDeadlineBar({
  countdown,
  snapshot = null,
  fallback = null,
  omit = false,
}: {
  countdown: TradeDeadlineCountdown | null | undefined
  snapshot?: SnapshotDeadline | null
  /** What to render when this is not a redraft shell, or the bar has nothing to say. */
  fallback?: React.ReactNode
  /**
   * Render nothing where the bar WOULD render. For the Trades history embedded under the Trade Center,
   * whose own bar already states the deadline: one deadline per page, and the history keeps its row
   * whenever the bar would have had nothing to say.
   */
  omit?: boolean
}) {
  const { ref, sport, decided } = useRedraftShellSport()
  const liveText = useTradeDeadlineCountdownText(countdown)
  const model = sport ? redraftDeadlineBar(snapshot, countdown) : null
  if (!decided) return <><span ref={ref} hidden data-rd-probe="" />{fallback}</>
  if (!model) return <>{fallback}</>
  if (omit) return null
  const value = model.state === 'counting' && liveText ? liveText : model.label
  return (
    <section className="af-rd-deadline" data-testid="rd-trade-deadline" data-state={model.state} aria-label="Trade deadline">
      <span className="af-rd-deadline-k">Trade deadline</span>
      <strong className="af-rd-deadline-v" role="status">{value}</strong>
      {model.fillPct != null ? (
        <span className="af-rd-deadline-meter" aria-hidden="true" style={{ '--rd-fill': `${model.fillPct}%` } as CSSProperties}>
          <span />
        </span>
      ) : null}
      {model.currentWeek != null && model.deadlineWeek != null ? (
        <span className="af-rd-deadline-sub af-num">
          Week {model.currentWeek} of {model.deadlineWeek}
        </span>
      ) : null}
    </section>
  )
}

export default RedraftTradeDeadlineBar
