import type { AwardTier, CareerAward } from '@/lib/core-app/careerAwards'

/**
 * Career award share cards (career brief item 8) — one award, or the whole
 * cabinet, as a 1080×1080 image.
 *
 * ⚠ SATORI RULES, SAME AS `ShareCard`: inline styles, literal hex, `display:flex`
 * on every element with more than one child, no grid. The route renders this
 * with `next/og`; the in-app awards tab renders its own badges and links here.
 *
 * ⚠ EVERY LINE ON THE CARD IS THE AWARD'S OWN EVIDENCE, the same string the
 * awards tab shows. Nothing is added for the image that the page does not say.
 */

export const AWARD_CARD_SIZE = { width: 1080, height: 1080 } as const

const C = {
  bg: '#0b1020',
  bgTo: '#060914',
  panel: '#11162c',
  line: 'rgba(255,255,255,0.12)',
  text: '#eef0fa',
  muted: '#a3a9cc',
  faint: '#7d84a8',
  accent: '#22d3ee',
} as const

const TIER: Record<AwardTier, { color: string; label: string }> = {
  bronze: { color: '#c98a55', label: 'BRONZE' },
  silver: { color: '#c3cbdd', label: 'SILVER' },
  gold: { color: '#fbbf24', label: 'GOLD' },
  platinum: { color: '#8fe3f0', label: 'PLATINUM' },
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export type AwardCardData = {
  handle: string
  award: CareerAward
}

export function AwardShareCard({ data }: { data: AwardCardData }) {
  const tier = TIER[data.award.tier]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: AWARD_CARD_SIZE.width,
        height: AWARD_CARD_SIZE.height,
        padding: 72,
        background: `linear-gradient(160deg, ${C.bg}, ${C.bgTo})`,
        color: C.text,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 6, color: C.accent, fontWeight: 800 }}>
          ALLFANTASY CAREER AWARD
        </div>
        <div style={{ display: 'flex', fontSize: 26, color: C.faint, fontWeight: 700 }}>{`@${data.handle}`}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 90 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 300,
            height: 300,
            borderRadius: 300,
            border: `12px solid ${tier.color}`,
            background: C.panel,
            color: tier.color,
            fontSize: 120,
            fontWeight: 900,
          }}
        >
          {initials(data.award.name)}
        </div>
        <div style={{ display: 'flex', marginTop: 44, fontSize: 30, letterSpacing: 8, color: tier.color, fontWeight: 800 }}>
          {`${tier.label} · ${data.award.earnedSeason}`}
        </div>
        <div style={{ display: 'flex', marginTop: 18, fontSize: 84, fontWeight: 900, letterSpacing: -2, textAlign: 'center' }}>
          {data.award.name}
        </div>
        <div style={{ display: 'flex', marginTop: 20, fontSize: 36, color: C.muted, textAlign: 'center', maxWidth: 860 }}>
          {data.award.evidence}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'auto',
          paddingTop: 28,
          borderTop: `1px solid ${C.line}`,
        }}
      >
        <div style={{ display: 'flex', fontSize: 24, color: C.faint, maxWidth: 640 }}>{data.award.blurb}</div>
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, color: C.text }}>allfantasy.ai</div>
      </div>
    </div>
  )
}

export type AwardCabinetData = {
  handle: string
  awards: CareerAward[]
  record: string | null
  titles: number
  seasons: number
}

/** The whole cabinet: up to six awards and the three numbers the overview leads with. */
export function AwardCabinetCard({ data }: { data: AwardCabinetData }) {
  const shown = data.awards.slice(0, 6)
  const rows = [shown.slice(0, 3), shown.slice(3, 6)].filter((r) => r.length > 0)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: AWARD_CARD_SIZE.width,
        height: AWARD_CARD_SIZE.height,
        padding: 64,
        background: `linear-gradient(160deg, ${C.bg}, ${C.bgTo})`,
        color: C.text,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', fontSize: 24, letterSpacing: 6, color: C.accent, fontWeight: 800 }}>
        ALLFANTASY TROPHY CABINET
      </div>
      <div style={{ display: 'flex', marginTop: 14, fontSize: 72, fontWeight: 900, letterSpacing: -2 }}>{`@${data.handle}`}</div>
      <div style={{ display: 'flex', marginTop: 26, gap: 18 }}>
        {[
          { l: 'TITLES', v: String(data.titles) },
          { l: 'RECORD', v: data.record ?? '—' },
          { l: 'SEASONS', v: String(data.seasons) },
          { l: 'AWARDS', v: String(data.awards.length) },
        ].map((k) => (
          <div
            key={k.l}
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              padding: '18px 22px',
              borderRadius: 18,
              background: C.panel,
              border: `1px solid ${C.line}`,
            }}
          >
            <div style={{ display: 'flex', fontSize: 40, fontWeight: 900 }}>{k.v}</div>
            <div style={{ display: 'flex', marginTop: 6, fontSize: 18, letterSpacing: 3, color: C.faint, fontWeight: 700 }}>{k.l}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 40 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', gap: 22 }}>
            {row.map((a) => {
              const tier = TIER[a.tier]
              return (
                <div
                  key={a.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: 296,
                    padding: '26px 18px',
                    borderRadius: 22,
                    background: C.panel,
                    border: `1px solid ${C.line}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 110,
                      height: 110,
                      borderRadius: 110,
                      border: `6px solid ${tier.color}`,
                      color: tier.color,
                      fontSize: 42,
                      fontWeight: 900,
                    }}
                  >
                    {initials(a.name)}
                  </div>
                  <div style={{ display: 'flex', marginTop: 14, fontSize: 17, letterSpacing: 3, color: tier.color, fontWeight: 800 }}>
                    {tier.label}
                  </div>
                  <div style={{ display: 'flex', marginTop: 6, fontSize: 28, fontWeight: 900, textAlign: 'center' }}>{a.name}</div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', fontSize: 24, fontWeight: 800 }}>
        allfantasy.ai
      </div>
    </div>
  )
}
