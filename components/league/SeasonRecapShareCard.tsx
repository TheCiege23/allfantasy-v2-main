import type { RecapCardView } from '@/lib/season-recap/seasonRecapCards'

/**
 * One season recap share card (1200×630), rendered by /api/share/season-recap-card with `next/og`.
 *
 * ⚠ SATORI RULES, SAME AS `AwardShareCard`: inline styles, literal hex, `display:flex` on every element
 * with more than one child, no grid. Every string comes from `recapCardView` — the recap page's own lines.
 */

export const RECAP_CARD_SIZE = { width: 1200, height: 630 } as const

const C = {
  bg: '#0b0e2a',
  bgTo: '#060914',
  text: '#f0f2ff',
  muted: '#b9bfe8',
  faint: '#8b93cf',
  gold: '#fbbf24',
  accent: '#22d3ee',
  line: 'rgba(255,255,255,0.12)',
} as const

export function SeasonRecapShareCard({ view, leagueName }: { view: RecapCardView; leagueName: string }) {
  const champion = view.kind === 'champion'
  const color = champion ? C.gold : C.accent
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: RECAP_CARD_SIZE.width,
        height: RECAP_CARD_SIZE.height,
        background: `linear-gradient(160deg, ${C.bg}, ${C.bgTo})`,
        color: C.text,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', height: 10, width: '100%', background: champion ? 'linear-gradient(90deg,#fbbf24,#f97316)' : 'linear-gradient(90deg,#22d3ee,#6366f1)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '40px 64px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 26, letterSpacing: 5, fontWeight: 800, color }}>{view.eyebrow.toUpperCase()}</div>
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: C.muted }}>{leagueName}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, letterSpacing: 3, color }}>
            {view.label.toUpperCase()}
          </div>
          <div style={{ display: 'flex', marginTop: 12, fontSize: view.value.length > 22 ? 72 : 96, fontWeight: 900, letterSpacing: -2, lineHeight: 1.05 }}>
            {view.value}
          </div>
          {view.detail ? <div style={{ display: 'flex', marginTop: 18, fontSize: 34, color: C.muted }}>{view.detail}</div> : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, color: C.text }}>allfantasy.ai</div>
        </div>
      </div>
    </div>
  )
}
