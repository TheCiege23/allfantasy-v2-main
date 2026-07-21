'use client'

/**
 * The hero product visual: a stylized AllFantasy dashboard with three floating
 * satellite cards (Chimmy chat, trade analyzer, notifications) and a phone.
 *
 * IMPORTANT: this is an *illustration*, not a live dashboard. Every number is
 * fixed sample data from `copy.ts` and is labelled "Sample data" for honesty —
 * it must never be mistaken for a real feed. Keeping it deterministic also
 * avoids hydration mismatches.
 *
 * Charts are hand-rolled SVG rather than recharts: they are decorative, fixed,
 * and on the critical render path of the marketing page, so pulling in a chart
 * runtime here would cost bundle size for zero interactivity.
 */

import {
  Search,
  Bell,
  Sparkles,
  ArrowLeftRight,
  TrendingUp,
  AlertTriangle,
  LayoutGrid,
} from 'lucide-react'
import { V3 } from './copy'

const M = V3.mock

// ── Fixed sample series ──────────────────────────────────────────────────────
const TREND_YOU = [42, 51, 47, 63, 58, 71, 66, 79]
const TREND_AVG = [45, 47, 50, 52, 54, 56, 59, 61]
const POSITION_BARS = [
  { label: 'QB', value: 82 },
  { label: 'RB', value: 54 },
  { label: 'WR', value: 91 },
  { label: 'TE', value: 68 },
  { label: 'K', value: 40 },
  { label: 'DEF', value: 73 },
]

const TONE_COLOR = {
  good: 'var(--good)',
  cyan: 'var(--cyan-bright)',
  purple: 'var(--purple-bright)',
  neutral: 'var(--text)',
  bad: 'var(--bad)',
} as const

export function V3DashboardMock() {
  return (
    <div style={{ position: 'relative' }}>
      <div className="mock">
        {/* Browser / app chrome */}
        <div className="mock-bar">
          <div style={{ display: 'flex', gap: 5 }} aria-hidden="true">
            {['#ef4444', '#f59e0b', '#22c55e'].map((c) => (
              <span key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.55 }} />
            ))}
          </div>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginLeft: 8,
              padding: '5px 11px',
              borderRadius: 7,
              background: 'rgba(255,255,255,.05)',
              border: '1px solid var(--line)',
              fontSize: 10.5,
              color: 'var(--text-4)',
              minWidth: 0,
            }}
          >
            <Search size={11} style={{ flex: 'none' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Search players, teams, leagues…
            </span>
          </div>
          <span className="pill pill-purple" style={{ padding: '4px 9px', fontSize: 10.5 }}>
            <Sparkles size={10} />
            Chimmy
          </span>
          <Bell size={13} style={{ color: 'var(--text-4)', flex: 'none' }} />
        </div>

        <div className="mock-body">
          {/* Sidebar */}
          <div className="mock-side">
            {M.nav.map((item, i) => (
              <div key={item} className={`mock-side-item${i === 0 ? ' is-active' : ''}`}>
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3.5,
                    flex: 'none',
                    background: i === 0 ? 'var(--purple)' : 'rgba(255,255,255,.1)',
                  }}
                />
                {item}
              </div>
            ))}
          </div>

          {/* Main */}
          <div className="mock-main">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{M.greeting}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-4)' }}>
                <span className="live-dot" />
                {M.clock}
              </div>
            </div>

            {/* Stat cards */}
            <div className="mock-stats">
              {M.stats.map((s) => (
                <div key={s.label} className="mock-stat">
                  <div className="mock-stat-label">{s.label}</div>
                  <div className="mock-stat-value num" style={{ color: TONE_COLOR[s.tone] }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 9.5, color: 'var(--text-4)', marginTop: 4 }}>{s.suffix}</div>
                </div>
              ))}
            </div>

            {/* Charts */}
            <div className="mock-panels">
              <div className="mock-panel">
                <div className="mock-panel-title">{M.panels.trend}</div>
                <LineChart />
                <Legend />
              </div>
              <div className="mock-panel">
                <div className="mock-panel-title">{M.panels.strength}</div>
                <BarChart />
              </div>
              <div className="mock-panel">
                <div className="mock-panel-title">{M.panels.waiver}</div>
                <RingChart />
              </div>
            </div>

            {/* Leagues */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {M.leagues.map((l) => (
                <div
                  key={l.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '8px 10px',
                    borderRadius: 9,
                    border: '1px solid var(--line)',
                    background: 'rgba(255,255,255,.02)',
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: l.tone,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 9.5,
                      fontWeight: 800,
                      color: '#fff',
                      flex: 'none',
                    }}
                  >
                    {l.name.charAt(0)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.name}
                    </div>
                    <div style={{ fontSize: 9.5, color: 'var(--text-4)' }}>{l.meta}</div>
                  </div>
                  <span className="num" style={{ fontSize: 11, color: 'var(--text-2)' }}>{l.record}</span>
                  <span className="pill pill-purple" style={{ padding: '2px 8px', fontSize: 9.5 }}>{l.place}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating satellite cards ────────────────────────────────────── */}
      <div className="mock-floats-docked">
        {/* Notifications */}
        <div className="mock-float mock-float-notif">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <Bell size={13} style={{ color: 'var(--purple-bright)' }} />
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{M.notifications.title}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {M.notifications.items.map((n) => {
              const Icon = n.tone === 'bad' ? AlertTriangle : n.tone === 'cyan' ? TrendingUp : ArrowLeftRight
              return (
                <div key={n.text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Icon size={12} style={{ color: TONE_COLOR[n.tone], flex: 'none', marginTop: 1 }} />
                  <span style={{ fontSize: 10.5, lineHeight: 1.4, color: 'var(--text-3)' }}>{n.text}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Chimmy chat */}
        <div className="mock-float mock-float-chimmy">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                background: 'linear-gradient(160deg,var(--purple),var(--purple-deep))',
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
              }}
            >
              <Sparkles size={11} style={{ color: '#fff' }} />
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{M.chimmy.label}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div className="chat-bubble chat-user" style={{ alignSelf: 'flex-end', maxWidth: '92%' }}>
              {M.chimmy.question}
            </div>
            <div className="chat-bubble chat-ai" style={{ alignSelf: 'flex-start', maxWidth: '94%' }}>
              {M.chimmy.answer}
            </div>
          </div>
        </div>

        {/* Trade analyzer */}
        <div className="mock-float mock-float-trade">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <ArrowLeftRight size={13} style={{ color: 'var(--cyan-bright)' }} />
            <span style={{ fontSize: 11.5, fontWeight: 600 }}>{M.trade.title}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
                {M.trade.give}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-2)', marginBottom: 7 }}>{M.trade.givePlayer}</div>
              <div style={{ fontSize: 9, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
                {M.trade.get}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--text-2)' }}>{M.trade.getPlayer}</div>
            </div>
            <div className="grade-badge num">{M.trade.grade}</div>
          </div>
        </div>
      </div>

      {/* Phone (desktop only — hidden under 1180px in CSS) */}
      <div className="mock-phone" aria-hidden="true">
        <div style={{ padding: '10px 10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <LayoutGrid size={11} style={{ color: 'var(--purple-bright)' }} />
              <span style={{ fontSize: 9.5, fontWeight: 700 }}>AllFantasy</span>
            </div>
            <span className="live-dot" />
          </div>
          {M.stats.slice(0, 3).map((s) => (
            <div
              key={s.label}
              style={{
                padding: '8px 9px',
                borderRadius: 9,
                border: '1px solid var(--line)',
                background: 'rgba(255,255,255,.03)',
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 8, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
                {s.label}
              </div>
              <div className="num" style={{ fontSize: 17, color: TONE_COLOR[s.tone], lineHeight: 1.2 }}>
                {s.value}
              </div>
            </div>
          ))}
          <div
            style={{
              marginTop: 8,
              padding: '8px 9px',
              borderRadius: 9,
              background: 'linear-gradient(160deg,var(--purple-deep),#5b21b6)',
            }}
          >
            <div style={{ fontSize: 8, fontWeight: 700, color: '#e9ddff', letterSpacing: '.06em' }}>CHIMMY</div>
            <div style={{ fontSize: 9, color: '#f4ecff', lineHeight: 1.4, marginTop: 3 }}>
              {M.chimmy.question}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Charts ───────────────────────────────────────────────────────────────────

/** Maps a series to an SVG polyline path within a 0..w / 0..h box. */
function toPath(series: readonly number[], w: number, h: number, pad = 2): string {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const stepX = (w - pad * 2) / (series.length - 1)
  return series
    .map((v, i) => {
      const x = pad + i * stepX
      const y = pad + (h - pad * 2) * (1 - (v - min) / span)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function LineChart() {
  const w = 150
  const h = 62
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Weekly scoring trend, sample data">
      <defs>
        <linearGradient id="v3-line-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${toPath(TREND_YOU, w, h)} L${w - 2},${h - 2} L2,${h - 2} Z`} fill="url(#v3-line-fill)" stroke="none" />
      <path className="spark-line" d={toPath(TREND_AVG, w, h)} stroke="rgba(255,255,255,.22)" strokeDasharray="3 3" />
      <path className="spark-line" d={toPath(TREND_YOU, w, h)} stroke="#a78bfa" />
    </svg>
  )
}

function Legend() {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 9, color: 'var(--text-4)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 10, height: 2, background: '#a78bfa', borderRadius: 2 }} />
        You
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 10, height: 2, background: 'rgba(255,255,255,.3)', borderRadius: 2 }} />
        League avg
      </span>
    </div>
  )
}

function BarChart() {
  const w = 150
  const h = 70
  const barW = 16
  const gap = (w - POSITION_BARS.length * barW) / (POSITION_BARS.length + 1)
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h + 12}`} role="img" aria-label="Position strength, sample data">
      {POSITION_BARS.map((b, i) => {
        const barH = Math.max(3, (b.value / 100) * h)
        const x = gap + i * (barW + gap)
        return (
          <g key={b.label}>
            <rect x={x} y={0} width={barW} height={h} rx={3} fill="rgba(255,255,255,.045)" />
            <rect
              className="bar"
              x={x}
              y={h - barH}
              width={barW}
              height={barH}
              rx={3}
              fill={b.value >= 70 ? '#22d3ee' : b.value >= 50 ? '#06b6d4' : 'rgba(6,182,212,.45)'}
            />
            <text x={x + barW / 2} y={h + 9} textAnchor="middle" fontSize="7" fill="#655d7d">
              {b.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function RingChart() {
  const pct = 0.64
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div style={{ display: 'grid', placeItems: 'center', paddingTop: 4 }}>
      <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="Waiver impact 64 percent, sample data">
        <circle className="ring-track" cx="36" cy="36" r={r} strokeWidth="7" />
        <circle
          className="ring-fill"
          cx="36"
          cy="36"
          r={r}
          strokeWidth="7"
          stroke="#8b5cf6"
          strokeDasharray={`${(c * pct).toFixed(1)} ${c.toFixed(1)}`}
        />
        <text x="36" y="40" textAnchor="middle" fontSize="16" fontWeight="700" fill="#f4f2fb" letterSpacing="-0.5">
          64%
        </text>
      </svg>
      <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 6 }}>FAAB spent</div>
    </div>
  )
}
