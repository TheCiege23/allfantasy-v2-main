import type { ShareCardData } from '@/lib/core-app/shareCard'

/**
 * Career share card — handoff 13b, 620×780.
 *
 * ⚠ ONE COMPONENT, TWO RENDERERS. This is rendered by React DOM for the in-app
 * preview and by satori for the PNG export, so the picture a user approves is
 * the picture that leaves the product. Keeping them as two implementations is
 * how a share card starts shipping a layout nobody reviewed.
 *
 * That dual use is why the markup looks the way it does:
 *
 *   Inline styles only     satori has no stylesheet.
 *   Literal hex, no tokens satori does not resolve CSS custom properties. This
 *                          is also correct on its own terms — the export is
 *                          always the dark card, never theme-aware, because it
 *                          is a static image pasted into someone else's app.
 *   display:flex on every  satori requires it on any element with more than one
 *   container              child, and silently drops children without it.
 *   No grid                satori does not implement it.
 *
 * ⚠ FIXED 620×780, NEVER RESPONSIVE. Build rule 1: the card is an export target
 * and must render identically regardless of viewport. Nothing here is allowed a
 * percentage width that depends on a container the export does not have.
 */

const C = {
  bg: '#0b1020',
  bgTo: '#070a16',
  panel: '#11162c',
  line: 'rgba(255,255,255,0.09)',
  line2: 'rgba(255,255,255,0.14)',
  text: '#eef0fa',
  muted: '#989fc2',
  faint: '#7d84a8',
  accent: '#22d3ee',
  warn: '#fbbf24',
  good: '#34d399',
} as const

/** Tier crest ramp — the same banding 14a's ladder colours use. */
const TIER_COLOR: Record<number, string> = {
  1: '#888780',
  2: '#4d9be0',
  3: '#7bc043',
  4: '#a78bfa',
  5: '#f6c445',
  6: '#f472a0',
  7: '#8b83e8',
}

export const SHARE_CARD_SIZE = { width: 620, height: 780 } as const

export function ShareCard({ data }: { data: ShareCardData }) {
  const crest = TIER_COLOR[data.tierGroup] ?? TIER_COLOR[1]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: SHARE_CARD_SIZE.width,
        height: SHARE_CARD_SIZE.height,
        background: `linear-gradient(160deg, ${C.bg} 0%, ${C.bgTo} 62%)`,
        border: `1px solid ${C.line2}`,
        borderRadius: 22,
        padding: 30,
        fontFamily: 'sans-serif',
        color: C.text,
      }}
    >
      {/* ── header: provenance stamp, always present ────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            borderRadius: 9,
            border: `1.5px solid ${C.accent}`,
            color: C.accent,
            fontSize: 13,
            fontWeight: 800,
            marginRight: 13,
          }}
        >
          AF
        </div>
        <div style={{ display: 'flex', fontSize: 12, letterSpacing: 3, color: C.faint, fontWeight: 700 }}>
          {data.era}
        </div>
        <div style={{ display: 'flex', flex: 1 }} />
        {/*
          The wordmark is the card's own provenance and is never conditional —
          this image is going to be seen outside the product, where nothing else
          says where it came from.
        */}
        <div style={{ display: 'flex', fontSize: 14, fontWeight: 800, color: C.accent, letterSpacing: 0.5 }}>
          allfantasy.ai
        </div>
      </div>

      {/* ── identity ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 30 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 78,
            height: 78,
            borderRadius: 18,
            border: `2px solid ${crest}`,
            background: 'rgba(255,255,255,0.03)',
            color: crest,
            fontSize: 34,
            marginRight: 20,
          }}
        >
          ★
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, letterSpacing: -1.5, color: C.text }}>
            {data.handle}
          </div>
          {data.subtitle ? (
            <div
              style={{
                display: 'flex',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 1.6,
                color: C.accent,
                marginTop: 8,
              }}
            >
              {data.subtitle}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── the two headline scores ──────────────────────────────────────── */}
      <div style={{ display: 'flex', marginTop: 26 }}>
        <ScorePanel label="GM PRESTIGE" value={fmt(data.prestige, 1)} color={C.accent} />
        <div style={{ display: 'flex', width: 16 }} />
        <ScorePanel label="LEGACY SCORE" value={fmt(data.legacy, 0)} color={C.warn} />
      </div>

      {/* ── the four stats, same as 13a's identity banner ────────────────── */}
      <div style={{ display: 'flex', marginTop: 24, width: '100%' }}>
        <Stat label="TITLES" value={String(data.titles)} color={C.warn} />
        <Stat label="RECORD" value={data.record ?? '—'} color={C.text} />
        <Stat label="WIN %" value={data.winRate ?? '—'} color={C.good} />
        <Stat label="AF XP" value={data.xp != null ? data.xp.toLocaleString() : '—'} color={C.text} />
      </div>

      {/* ── the rings ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginTop: 24,
          padding: 18,
          border: `1px solid ${C.line}`,
          borderRadius: 14,
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <div style={{ display: 'flex', fontSize: 11, letterSpacing: 2.6, color: C.faint, fontWeight: 700 }}>
          THE RINGS
        </div>
        {data.rings.length === 0 ? (
          <div style={{ display: 'flex', fontSize: 14, color: C.muted, marginTop: 12 }}>
            No championships on record yet.
          </div>
        ) : (
          data.rings.map((r) => (
            <div
              key={`${r.season}-${r.leagueName}`}
              style={{ display: 'flex', alignItems: 'center', marginTop: 13, width: '100%' }}
            >
              <div style={{ display: 'flex', color: C.warn, fontSize: 16, marginRight: 12 }}>★</div>
              <div style={{ display: 'flex', fontSize: 19, fontWeight: 700, color: C.text }}>
                {r.leagueName}
              </div>
              <div style={{ display: 'flex', flex: 1 }} />
              <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, color: C.muted }}>
                {r.season}
              </div>
            </div>
          ))
        )}
        {/*
          The card lists three. A manager with more is told so rather than being
          shown a truncated list that reads as the whole shelf.
        */}
        {data.ringsOverflow > 0 ? (
          <div style={{ display: 'flex', fontSize: 12, color: C.faint, marginTop: 13 }}>
            + {data.ringsOverflow} more not shown
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flex: 1 }} />

      {/* ── the callout ──────────────────────────────────────────────────── */}
      {data.callout ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: 18,
            border: `1px solid rgba(34,211,238,0.3)`,
            borderRadius: 14,
            background: 'rgba(34,211,238,0.07)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'rgba(34,211,238,0.16)',
              color: C.accent,
              fontSize: 17,
              fontWeight: 800,
              marginRight: 15,
            }}
          >
            C
          </div>
          <div style={{ display: 'flex', flex: 1, fontSize: 17, fontWeight: 700, lineHeight: 1.4, color: C.text }}>
            {data.callout}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function fmt(n: number | null, dp: number): string {
  return n == null ? '—' : n.toFixed(dp)
}

function ScorePanel({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        padding: 18,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      <div style={{ display: 'flex', fontSize: 11, letterSpacing: 2.4, color: C.faint, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ display: 'flex', fontSize: 52, fontWeight: 800, color, letterSpacing: -2, marginTop: 10 }}>
        {value}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', fontSize: 10, letterSpacing: 2, color: C.faint, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ display: 'flex', fontSize: 27, fontWeight: 800, color, letterSpacing: -1, marginTop: 9 }}>
        {value}
      </div>
    </div>
  )
}
