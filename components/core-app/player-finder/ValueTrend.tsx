'use client'

import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import { lockSubjectText } from '@/lib/core-app/coreDepthLockCopy'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { consecutiveRuns, type BookTrend, type Change, type ValueTrend as ValueTrendData } from '@/lib/core-app/valueTrend'
import { bookLabelText, nudgeText, shortDateText, tradeValueCopy, type TradeValueCopy } from '@/lib/core-app/finderTradeValueCopy'

/**
 * "Market value, last 30 days" — his value per book your leagues price on, with a sparkline, the week's
 * and the month's change, and (AF Pro) a buy-low / sell-high nudge when the week's move is unusual for
 * that book (lib/core-app/valueTrend.ts).
 *
 * Spanish (2026-10-05): the words come from finderTradeValueCopy.ts, the nudge is rebuilt from its
 * parts, and the pinned en-US date ("Sep 28") reads "28 sep" through `kickoffText`. The AF Pro lock is
 * the shared CoreDepthLock, in the reader's language too (coreDepthLockCopy.ts).
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const W = 120
const H = 32
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)

function Sparkline({ t, copy, language }: { t: BookTrend; copy: TradeValueCopy; language: string }) {
  const pts = t.points
  const lo = Math.min(...pts.map((p) => p.value))
  const hi = Math.max(...pts.map((p) => p.value))
  const t0 = dayMs(pts[0].day)
  const span = Math.max(1, dayMs(pts[pts.length - 1].day) - t0)
  const x = (d: string) => ((dayMs(d) - t0) / span) * (W - 4) + 2
  const y = (v: number) => (hi === lo ? H / 2 : H - 2 - ((v - lo) / (hi - lo)) * (H - 4))
  const dir = t.change7 ? Math.sign(t.change7.pct) : 0
  const label = copy.sparkLabel(
    shortDateText(DATE.format(new Date(dayMs(pts[0].day))), language),
    shortDateText(DATE.format(new Date(dayMs(t.lastDay))), language),
    pts[0].value.toLocaleString('en-US'),
    t.value.toLocaleString('en-US'),
  )
  return (
    <svg className={`af-pf-vt-spark${dir > 0 ? ' is-up' : dir < 0 ? ' is-down' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      {consecutiveRuns(pts).map((run) =>
        run.length === 1 ? (
          <circle key={run[0].day} cx={x(run[0].day)} cy={y(run[0].value)} r={1.4} />
        ) : (
          <polyline key={run[0].day} points={run.map((p) => `${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')} />
        ),
      )}
    </svg>
  )
}

function ChangeChip({ c, label, copy }: { c: Change | null; label: string; copy: TradeValueCopy }) {
  if (!c) return <span className="af-pf-vt-chg is-none">{copy.notEnoughHistory(label)}</span>
  const r = Math.round(c.pct * 100)
  const cls = r > 0 ? 'is-up' : r < 0 ? 'is-down' : 'is-flat'
  return (
    <span className={`af-pf-vt-chg ${cls} af-num`}>
      {label}: {r > 0 ? '+' : r < 0 ? '−' : '±'}
      {Math.abs(r)}%
    </span>
  )
}

export function ValueTrend({ data, access }: { data: ValueTrendData | null; access: CoreDepthAccess | null }) {
  const { language } = useOptionalLanguage()
  const copy = tradeValueCopy(language)
  if (!data || data.books.length === 0) return null
  return (
    <section className="af-card af-pf-vt" aria-labelledby="af-pf-vt-h">
      <h3 className="af-label" id="af-pf-vt-h">
        {copy.trendHeading}
      </h3>
      <ul className="af-pf-vt-list">
        {data.books.map((t) => (
          <li key={t.label} className="af-pf-vt-row">
            <div className="af-pf-vt-head">
              <span className="af-pf-vt-book">{bookLabelText(t.label, language)}</span>
              {t.leagues > 0 ? (
                <span className="af-pf-vt-scope">
                  {copy.trendScope(t.leagues)}
                  {t.yours > 0 ? copy.trendYoursIn(t.yours) : ''}
                </span>
              ) : (
                <span className="af-pf-vt-scope">{copy.trendDefaultChart}</span>
              )}
            </div>
            <div className="af-pf-vt-body">
              <span className="af-pf-vt-value af-num">{t.value.toLocaleString('en-US')}</span>
              {t.points.length > 1 ? <Sparkline t={t} copy={copy} language={language} /> : null}
              <span className="af-pf-vt-chgs">
                <ChangeChip c={t.change7} label={copy.sevenDays} copy={copy} />
                <ChangeChip
                  c={t.change30}
                  label={t.change30 ? copy.sinceDay(shortDateText(DATE.format(new Date(dayMs(t.change30.fromDay))), language)) : copy.month}
                  copy={copy}
                />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {data.nudge ? (
        <p className={`af-pf-vt-nudge is-${data.nudge.kind}`}>
          <strong>{copy.nudgeHead(data.nudge.kind)}</strong>{' '}
          <span>
            ({bookLabelText(data.nudge.bookLabel, language)}) {nudgeText(data.nudge, language)}
          </span>
        </p>
      ) : null}
      {data.nudgeLocked && access ? <CoreDepthLock access={access} what={lockSubjectText('Buy-low and sell-high calls', language)} lang={language} /> : null}
      <p className="af-pf-vt-foot">{copy.trendFoot}</p>
    </section>
  )
}
