'use client'

/**
 * "Trade deadline in 3d 4h", then "Trades closed" — the chip on the Trade Center and the league home.
 *
 * The STATE comes from the server's verdict (lib/trade-deadline/tradeDeadlineCountdown.ts); this only
 * keeps a close time's countdown current while the screen is open, ticking once a minute. When the
 * clock reaches the close time it reads "Trades closed", which is what the engine says from that same
 * instant — a close time is exact, unlike a week-only deadline, which is never counted in hours here.
 */

import { useEffect, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { countdownParts, type TradeDeadlineCountdown } from '@/lib/trade-deadline/tradeDeadlineCountdown'
import type { PickTradeDeadlineView } from '@/lib/trade-deadline/pickTradeDeadline'

export function useTradeDeadlineCountdownText(countdown: TradeDeadlineCountdown | null | undefined): string | null {
  const { tInterpolate } = useOptionalLanguage()
  const closesAt = countdown?.state === 'counting' ? Date.parse(countdown.closesAtIso) : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (closesAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [closesAt])

  if (!countdown || countdown.state === 'none') return null
  if (countdown.state === 'closed') return tInterpolate('tradeDeadline.countdown.closed')
  if (countdown.state === 'counting') {
    const remaining = (closesAt ?? now) - now
    if (remaining <= 0) return tInterpolate('tradeDeadline.countdown.closed')
    const { days, hours, minutes } = countdownParts(remaining)
    const span =
      days > 0
        ? tInterpolate('tradeDeadline.span.daysHours', { d: days, h: hours })
        : hours > 0
          ? tInterpolate('tradeDeadline.span.hoursMinutes', { h: hours, m: minutes })
          : minutes > 0
            ? tInterpolate('tradeDeadline.span.minutes', { m: minutes })
            : tInterpolate('tradeDeadline.span.underMinute')
    return tInterpolate('tradeDeadline.countdown.in', { span })
  }
  if (countdown.state === 'weeks') {
    if (countdown.weeksLeft === 0) return tInterpolate('tradeDeadline.countdown.lastWeek', { week: countdown.deadlineWeek })
    return tInterpolate(
      countdown.weeksLeft === 1 ? 'tradeDeadline.countdown.oneWeekLeft' : 'tradeDeadline.countdown.weeksLeft',
      { week: countdown.deadlineWeek, count: countdown.weeksLeft },
    )
  }
  return countdown.deadlineWeek != null
    ? tInterpolate('tradeDeadline.countdown.scheduled', { week: countdown.deadlineWeek })
    : tInterpolate('tradeDeadline.countdown.scheduledTime')
}

export function TradeDeadlineCountdownChip(props: {
  countdown: TradeDeadlineCountdown | null | undefined
  className?: string
}) {
  const text = useTradeDeadlineCountdownText(props.countdown)
  const closedText = useOptionalLanguage().tInterpolate('tradeDeadline.countdown.closed')
  if (!text) return null
  const closed = props.countdown?.state === 'closed' || text === closedText
  return (
    <span
      className={props.className}
      data-deadline-state={closed ? 'closed' : props.countdown?.state}
      role="status"
      style={{ fontSize: 12 }}
    >
      {text}
    </span>
  )
}

/**
 * A dynasty league's separate pick-trade rule (lib/trade-deadline/pickTradeDeadline.ts), beside the trade
 * deadline chip: "Pick trades open all season", "Pick trades through Week 16", "Pick trades closed".
 * Renders nothing when pick trades follow the trade deadline.
 */
export function PickTradeDeadlineChip(props: { view: PickTradeDeadlineView | null | undefined; className?: string }) {
  const { tInterpolate } = useOptionalLanguage()
  const v = props.view
  if (!v) return null
  const text = v.passed
    ? tInterpolate('tradeDeadline.picks.closed')
    : v.mode === 'open'
      ? tInterpolate('tradeDeadline.picks.open')
      : tInterpolate('tradeDeadline.picks.through', { week: v.week ?? '?' })
  return (
    <span className={props.className} data-deadline-state={v.passed ? 'closed' : v.mode} role="status" style={{ fontSize: 12 }} data-testid="pick-trade-deadline-chip">
      {text}
    </span>
  )
}
