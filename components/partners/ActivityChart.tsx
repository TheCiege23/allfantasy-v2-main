'use client'

import { useEffect, useRef, useState } from 'react'
import { VIZ } from '@/components/partners/vizTokens'

/**
 * Platform activity: one series (manager actions per week, summed across leagues), so no legend box — the
 * title names it. 2px line, recessive grid, crosshair + tooltip on hover/focus, and a table view.
 */
export function ActivityChart({ labels, values, title }: { labels: readonly string[]; values: readonly number[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null)
  /*
   * Drawn at the container's real width, not scaled from a fixed viewBox: scaled down to a phone, 11px axis
   * text became ~6px. 640 is the first paint (and the server render); the observer corrects it on mount.
   */
  const boxRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0)
      if (w > 0) setW(Math.max(280, w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const H = W < 480 ? 200 : 220
  const pad = { l: 44, r: 28, t: 16, b: 28 }
  /*
   * A line encodes change, so the axis fits the data (a bar would need zero). From zero, 1,515 → 1,397 drew as
   * a flat line and hid the trend a partner is looking for; the tick labels say where the axis starts.
   */
  const hi = Math.max(1, ...values)
  const lo = Math.min(...values, hi)
  const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, hi - lo || hi)))) / 2)
  const min = Math.max(0, Math.floor((lo - (hi - lo) * 0.15) / step) * step)
  const max = Math.ceil((hi + (hi - lo) * 0.15) / step) * step
  const ticks = [min, (min + max) / 2, max]
  const x = (i: number) => pad.l + (values.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (values.length - 1))
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min || 1))
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = values.length - 1

  return (
    <figure className="m-0" aria-label={title}>
      <div className="relative" ref={boxRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block w-full h-auto" role="img" aria-label={`${title}: ${values.join(', ')}`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={VIZ.grid} strokeWidth={1} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={VIZ.axis}>
                {Math.round(t).toLocaleString()}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            // Every other week on a narrow chart, so labels never collide; the latest week always shows.
            W >= 480 || i % 2 === (labels.length - 1) % 2 ? (
              <text key={l} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={VIZ.axis}>
                {l}
              </text>
            ) : null,
          )}
          <path d={path} fill="none" stroke={VIZ.series1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* Direct label on the latest point only — never a number on every point. */}
          <circle cx={x(last)} cy={y(values[last] ?? 0)} r={4} fill={VIZ.series1} stroke={VIZ.surface} strokeWidth={2} />
          <text x={x(last) - 6} y={y(values[last] ?? 0) - 10} textAnchor="end" fontSize={12} fill={VIZ.textPrimary} fontWeight={600}>
            {(values[last] ?? 0).toLocaleString()}
          </text>
          {hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={VIZ.axis} strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(values[hover] ?? 0)} r={5} fill={VIZ.series1} stroke={VIZ.surface} strokeWidth={2} />
            </g>
          )}
          {/* Hit targets wider than the marks: one column per week. */}
          {values.map((_, i) => {
            const w = values.length > 1 ? (W - pad.l - pad.r) / (values.length - 1) : W
            return (
              <rect
                key={i}
                x={x(i) - w / 2}
                y={pad.t}
                width={w}
                height={H - pad.t - pad.b}
                fill="transparent"
                tabIndex={0}
                aria-label={`${labels[i]}: ${values[i]?.toLocaleString()} actions`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            )
          })}
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute rounded-md border border-white/15 bg-[#11182a] px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, top: 0, transform: 'translate(-50%, 0)' }}
            role="status"
          >
            <div className="text-white/60">{labels[hover]}</div>
            <div className="font-semibold text-white">{values[hover]?.toLocaleString()} actions</div>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-white/60">
        <summary className="cursor-pointer select-none">View as table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-white/45">
              <th className="py-1 font-medium">Week</th>
              <th className="py-1 text-right font-medium">Manager actions</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l} className="border-t border-white/5">
                <td className="py-1">{l}</td>
                <td className="py-1 text-right tabular-nums">{values[i]?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <span className="sr-only">
        Axis from {min.toLocaleString()} to {max.toLocaleString()}
      </span>
    </figure>
  )
}
