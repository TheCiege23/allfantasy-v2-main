import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { consecutiveRuns, type BookTrend, type Change, type ValueTrend as ValueTrendData } from '@/lib/core-app/valueTrend'

/**
 * "Market value, last 30 days" — his value per book your leagues price on, with a sparkline, the week's
 * and the month's change, and (AF Pro) a buy-low / sell-high nudge when the week's move is unusual for
 * that book (lib/core-app/valueTrend.ts).
 */

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const W = 120
const H = 32
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)

function Sparkline({ t }: { t: BookTrend }) {
  const pts = t.points
  const lo = Math.min(...pts.map((p) => p.value))
  const hi = Math.max(...pts.map((p) => p.value))
  const t0 = dayMs(pts[0].day)
  const span = Math.max(1, dayMs(pts[pts.length - 1].day) - t0)
  const x = (d: string) => ((dayMs(d) - t0) / span) * (W - 4) + 2
  const y = (v: number) => (hi === lo ? H / 2 : H - 2 - ((v - lo) / (hi - lo)) * (H - 4))
  const dir = t.change7 ? Math.sign(t.change7.pct) : 0
  return (
    <svg className={`af-pf-vt-spark${dir > 0 ? ' is-up' : dir < 0 ? ' is-down' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Value from ${DATE.format(new Date(dayMs(pts[0].day)))} to ${DATE.format(new Date(dayMs(t.lastDay)))}: ${pts[0].value.toLocaleString('en-US')} to ${t.value.toLocaleString('en-US')}`} preserveAspectRatio="none">
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

function ChangeChip({ c, label }: { c: Change | null; label: string }) {
  if (!c) return <span className="af-pf-vt-chg is-none">{label}: not enough history</span>
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
  if (!data || data.books.length === 0) return null
  return (
    <section className="af-card af-pf-vt" aria-labelledby="af-pf-vt-h">
      <h3 className="af-label" id="af-pf-vt-h">
        Market value, last 30 days
      </h3>
      <ul className="af-pf-vt-list">
        {data.books.map((t) => (
          <li key={t.label} className="af-pf-vt-row">
            <div className="af-pf-vt-head">
              <span className="af-pf-vt-book">{t.label}</span>
              {t.leagues > 0 ? (
                <span className="af-pf-vt-scope">
                  {t.leagues} of your {t.leagues === 1 ? 'league' : 'leagues'}
                  {t.yours > 0 ? ` · yours in ${t.yours}` : ''}
                </span>
              ) : (
                <span className="af-pf-vt-scope">default chart — no league in view</span>
              )}
            </div>
            <div className="af-pf-vt-body">
              <span className="af-pf-vt-value af-num">{t.value.toLocaleString('en-US')}</span>
              {t.points.length > 1 ? <Sparkline t={t} /> : null}
              <span className="af-pf-vt-chgs">
                <ChangeChip c={t.change7} label="7 days" />
                <ChangeChip c={t.change30} label={t.change30 ? `since ${DATE.format(new Date(dayMs(t.change30.fromDay)))}` : 'month'} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {data.nudge ? (
        <p className={`af-pf-vt-nudge is-${data.nudge.kind}`}>
          <strong>{data.nudge.kind === 'sell-high' ? 'Sell-high window' : data.nudge.kind === 'buy-low' ? 'Buy-low window' : 'Big drop'}</strong>{' '}
          <span>
            ({data.nudge.bookLabel}) {data.nudge.text}
          </span>
        </p>
      ) : null}
      {data.nudgeLocked && access ? <CoreDepthLock access={access} what="Buy-low and sell-high calls" /> : null}
      <p className="af-pf-vt-foot">
        FantasyCalc market value, captured daily; a missed day is a gap in the line, not a guess. Moves are judged against
        every player on the same chart, because redraft values swing about twice as hard as dynasty.
      </p>
    </section>
  )
}
