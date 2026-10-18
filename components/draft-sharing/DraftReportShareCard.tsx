import { adpBasisLabel, type DraftReportCard, type ReportCardPick } from '@/lib/post-draft-manager-ranking/reportCard'

/**
 * Post-draft report card share image — 1080×1080, rendered by `next/og` (satori)
 * from `GET /api/share/draft?card=report`.
 *
 * ⚠ SATORI RULES: every element with more than one child is `display: flex`, no
 * CSS variables, no external fonts.
 *
 * The ADP basis line travels with the grade: a value claim means nothing without
 * saying which ADP it was measured against.
 */

export const REPORT_CARD_SIZE = { width: 1080, height: 1080 } as const

const C = {
  bg: '#0a0f1f',
  panel: '#111a33',
  line: '#22305a',
  text: '#f2f5ff',
  sub: '#93a0cc',
  faint: '#5f6b98',
  accent: '#22d3ee',
  good: '#34d399',
  bad: '#fb7185',
}

function gradeColor(grade: string): string {
  const l = grade.charAt(0).toUpperCase()
  if (l === 'A') return '#34d399'
  if (l === 'B') return '#22d3ee'
  if (l === 'C') return '#fbbf24'
  return '#fb923c'
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

function PickPanel({ title, pick, tone }: { title: string; pick: ReportCardPick | null; tone: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 24, padding: '26px 30px' }}>
      <div style={{ display: 'flex', fontSize: 20, fontWeight: 800, letterSpacing: 2, color: C.faint }}>{title}</div>
      {pick ? (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
          <div style={{ display: 'flex', fontSize: 38, fontWeight: 900, color: C.text }}>{pick.playerName}</div>
          <div style={{ display: 'flex', fontSize: 22, color: C.sub, marginTop: 4 }}>
            {`${pick.position}${pick.team ? ` · ${pick.team}` : ''} · Rd ${pick.round}, #${pick.overall} · ADP ${pick.adp}`}
          </div>
          <div style={{ display: 'flex', fontSize: 52, fontWeight: 900, color: tone, marginTop: 10 }}>{`${signed(pick.delta)} spots`}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', fontSize: 26, color: C.sub, marginTop: 14 }}>None — every pick stayed near ADP</div>
      )}
    </div>
  )
}

export function DraftReportShareCard({ card }: { card: DraftReportCard }) {
  const positions = card.positions.slice(0, 6)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: C.bg, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', height: 10, width: '100%', background: `linear-gradient(90deg, ${C.accent}, ${gradeColor(card.grade)})` }} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '44px 56px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 680 }}>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 800, letterSpacing: 3, color: C.accent }}>DRAFT REPORT CARD</div>
            <div style={{ display: 'flex', fontSize: 56, fontWeight: 900, color: C.text, marginTop: 8 }}>{card.displayName}</div>
            <div style={{ display: 'flex', fontSize: 24, color: C.sub, marginTop: 6 }}>
              {`${card.leagueName ?? 'League'} · ${card.sport} · ${card.season}`}
            </div>
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: C.text, marginTop: 22 }}>
              {`Ranked #${card.rank} of ${card.teamCount} drafts`}
            </div>
            <div style={{ display: 'flex', fontSize: 24, color: C.sub, marginTop: 6 }}>
              {`${signed(card.totalValue)} spots of value vs ADP · ${card.valuePicks} value · ${card.evenPicks} on ADP · ${card.reachPicks} reach`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 230, height: 230, borderRadius: 40, border: `4px solid ${gradeColor(card.grade)}`, background: C.panel }}>
            <div style={{ display: 'flex', fontSize: 130, fontWeight: 900, color: gradeColor(card.grade) }}>{card.grade}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 22, marginTop: 40 }}>
          <PickPanel title="BEST STEAL" pick={card.bestSteal} tone={C.good} />
          <PickPanel title="BIGGEST REACH" pick={card.biggestReach} tone={C.bad} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 24, padding: '24px 30px' }}>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 800, letterSpacing: 2, color: C.faint }}>ROSTER BUILD</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
            {positions.map((p) => (
              <div key={p.position} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, background: C.bg, borderRadius: 18, padding: '14px 8px' }}>
                <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: C.sub }}>{p.position}</div>
                <div style={{ display: 'flex', fontSize: 46, fontWeight: 900, color: C.text }}>{`${p.count}`}</div>
                <div style={{ display: 'flex', fontSize: 20, color: p.value > 0 ? C.good : p.value < 0 ? C.bad : C.faint }}>{signed(p.value)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
          <div style={{ display: 'flex', fontSize: 18, color: C.faint, maxWidth: 640 }}>{adpBasisLabel(card.adpBasis)}</div>
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: C.good }}>AllFantasy.ai</div>
        </div>
      </div>
    </div>
  )
}

export default DraftReportShareCard
