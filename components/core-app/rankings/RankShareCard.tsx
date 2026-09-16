import type { RankCardData } from '@/lib/core-app/rankings'

/**
 * The rank share card — 1200×630, rendered by `next/og` (satori).
 *
 * ⚠ SATORI RULES: every element with more than one child is `display: flex`, no
 * CSS variables, no external fonts. The sibling career card documents why no
 * custom face is loaded.
 *
 * ⚠ CONTEXT TRAVELS WITH THE NUMBER. A bare "#2" invites the reader to assume a
 * global ladder, so the card always carries the board, the filters, the
 * population, the sample, the calculation time and the method in one line.
 */

export const RANK_CARD_SIZE = { width: 1200, height: 630 } as const

const C = {
  bg: '#0b0e2a',
  panel: '#12163e',
  line: '#262c6a',
  text: '#f0f2ff',
  sub: '#8b93cf',
  faint: '#5d64a3',
  accent: '#7c8cff',
  warm: '#ff8a3d',
  good: '#3ddc97',
}

function fmt(iso: string | null): string {
  if (!iso) return 'unknown'
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })
}

export function RankShareCard({ data }: { data: RankCardData }) {
  const shown = data.components.filter((c) => c.available)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: C.bg, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', height: 8, width: '100%', background: `linear-gradient(90deg, ${C.accent}, ${C.warm})` }} />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '34px 48px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, letterSpacing: 2, color: C.warm }}>
              {`ALLFANTASY RANKING · ${data.scopeLabel.toUpperCase()}`}
            </div>
            <div style={{ display: 'flex', fontSize: 46, fontWeight: 900, color: C.text, marginTop: 4 }}>{`@${data.handle}`}</div>
            <div style={{ display: 'flex', fontSize: 18, color: C.sub, marginTop: 2 }}>
              {`Level ${data.level} ${data.levelName} · ${data.tier} tier`}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', fontSize: 96, fontWeight: 900, color: C.text, lineHeight: 1 }}>
              {data.rank ? `#${data.rank.rank}` : data.metric}
            </div>
            <div style={{ display: 'flex', fontSize: 18, color: C.sub }}>
              {data.rank ? `of ${data.rank.of} ranked managers · ${data.boardLabel}` : data.metricLabel}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 30, flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 280, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: '22px 26px' }}>
            <div style={{ display: 'flex', fontSize: 14, fontWeight: 700, color: C.faint, letterSpacing: 1 }}>{data.rank ? data.boardLabel.toUpperCase() : 'AF MANAGER SCORE'}</div>
            <div style={{ display: 'flex', fontSize: 64, fontWeight: 900, color: C.accent, marginTop: 10 }}>{data.metric}</div>
            <div style={{ display: 'flex', fontSize: 16, color: C.sub, marginTop: 6 }}>{data.score == null ? 'Score not measured' : `AF manager score ${data.score.toFixed(1)} / 100`}</div>
            <div style={{ display: 'flex', fontSize: 15, color: C.faint, marginTop: 'auto' }}>{`${data.sample}`}</div>
            <div style={{ display: 'flex', fontSize: 15, color: C.faint, marginTop: 4 }}>{`${data.confidence} confidence · ${data.filtersLabel}`}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 18, padding: '20px 26px' }}>
            <div style={{ display: 'flex', fontSize: 14, fontWeight: 700, color: C.faint, letterSpacing: 1 }}>WHERE THE SCORE COMES FROM</div>
            {shown.map((c) => (
              <div key={c.label} style={{ display: 'flex', flexDirection: 'column', marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: C.text }}>{c.label}</div>
                  <div style={{ display: 'flex', fontSize: 18, color: C.sub }}>{`${c.value} · +${c.points.toFixed(1)}`}</div>
                </div>
                <div style={{ display: 'flex', height: 8, marginTop: 8, borderRadius: 8, background: C.line }}>
                  <div style={{ display: 'flex', height: 8, borderRadius: 8, width: `${Math.round((c.credit ?? 0) * 100)}%`, background: C.accent }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 18 }}>
          <div style={{ display: 'flex', fontSize: 15, color: C.sub }}>
            {`Newest import ${fmt(data.newestImport)} · calculated ${fmt(data.computedAt)} · titles and berths judged against each league’s field size and playoff cut`}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div style={{ display: 'flex', fontSize: 14, color: C.faint }}>
              Win rate per game · scoring against same-format teams · method in Rankings → How ranking works
            </div>
            <div style={{ display: 'flex', fontSize: 18, fontWeight: 800, color: C.good }}>AllFantasy.ai · a Brown Pig LLC product</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RankShareCard
