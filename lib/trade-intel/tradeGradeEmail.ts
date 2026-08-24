import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import type {
  GradedTrade,
  TradeAsset,
  TradePickAsset,
  TradeSideGrade,
} from '@/lib/trade-intel/sleeperTradeGradeService'
import type {
  AssetExpectation,
  SideExpectation,
  TradeExpectation,
} from '@/lib/trade-intel/tradeExpectation'
// TYPE-ONLY on purpose: the loader is `server-only`, and a value import from it
// would drag prisma into this renderer. Vitest stubs `server-only`, so a test
// suite would stay green while the module became unusable in a pure context.
import type { TradePsychologyContext } from '@/lib/trade-intel/tradePsychologyLoader'

/**
 * tradeGradeEmail — the "your league just traded" email, as a real visual.
 *
 * Two jobs beyond looking better than a paragraph:
 *
 * 1. SHOW THE TRADE. Each side is a card: what he got, what he gave, and the
 *    points actually credited to each asset. A trade is a swap, so it should
 *    read as one.
 *
 * 2. DON'T LAUNDER "NO DATA" INTO A VERDICT. initialGrade is letterFor(net of
 *    the trade season), and the C band is just -40 < net < 40. Before any game
 *    is played every net is 0, so every side grades C — a placeholder that
 *    reads to a manager as "average trade". When nothing has accrued we say so
 *    outright and label the letter provisional, in the subject line too.
 *
 * Email HTML rules followed here: tables not flex, inline styles only, solid
 * hex (Outlook's Word engine drops rgba), 640px max, no external assets.
 */

// Nocturne dark, matching the early-access template but with solid hexes.
const BG = '#0b0b0f'
const CARD = '#15151c'
const BORDER = '#262631'
const TEXT = '#ffffff'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const GOT_ACCENT = '#4ade80'
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"

const GRADE_COLORS: Record<GradeLetter, { bg: string; fg: string }> = {
  A: { bg: '#123524', fg: '#4ade80' },
  B: { bg: '#0f2f3d', fg: '#38bdf8' },
  C: { bg: '#2a2416', fg: '#fbbf24' },
  D: { bg: '#33200f', fg: '#fb923c' },
  F: { bg: '#331417', fg: '#f87171' },
}
const PROVISIONAL_COLORS = { bg: '#1f1f27', fg: '#a1a1aa' }

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmt(points: number): string {
  return (Math.round(points * 10) / 10).toFixed(1)
}

function signed(points: number): string {
  const rounded = Math.round(points * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`
}

/** The season initialGrade was computed from — seasonNets[0] in the engine. */
function gradedSeason(side: TradeSideGrade): string | null {
  return side.seasonNets[0]?.season ?? null
}

function playerPoints(assets: TradeAsset[], season: string | null): number {
  if (!season) return 0
  return assets.reduce((acc, a) => acc + (a.creditedBySeason[season] ?? 0), 0)
}

function pickPoints(picks: TradePickAsset[], season: string | null): number {
  if (!season) return 0
  return picks.reduce((acc, p) => acc + (p.resolved?.creditedBySeason[season] ?? 0), 0)
}

export type SideMath = {
  season: string | null
  got: number
  gave: number
  /** got - gave; this is exactly what letterFor() was handed. */
  net: number
  partial: boolean
}

export function sideMath(side: TradeSideGrade): SideMath {
  const season = gradedSeason(side)
  const got = playerPoints(side.playersIn, season) + pickPoints(side.picksIn, season)
  const gave = playerPoints(side.playersOut, season) + pickPoints(side.picksOut, season)
  return {
    season,
    got: Math.round(got * 10) / 10,
    gave: Math.round(gave * 10) / 10,
    net: Math.round((got - gave) * 10) / 10,
    partial: side.seasonNets[0]?.partial ?? false,
  }
}

/**
 * True when not a single point has been credited to anybody in the trade.
 *
 * This is the case the old email hid: every net is 0, so every side lands in the
 * C band, and the engine reports a tie. It knows nothing yet, and saying "C"
 * without saying that is the dishonest part.
 */
export function hasNoSignal(trade: GradedTrade): boolean {
  return trade.sides.every((side) => {
    const m = sideMath(side)
    return m.got === 0 && m.gave === 0
  })
}

/** Picks that cannot contribute yet because the draft has not resolved them. */
function unresolvedPickLabels(trade: GradedTrade): string[] {
  const labels = new Set<string>()
  for (const side of trade.sides) {
    for (const pick of [...side.picksIn, ...side.picksOut]) {
      if (pick.pending) labels.add(pick.label)
    }
  }
  return [...labels]
}

function assetRow(label: string, detail: string | null, points: number | null, accent: boolean): string {
  const pts =
    points == null
      ? ''
      : `<span style="color:${accent ? GOT_ACCENT : MUTED};font-weight:600;white-space:nowrap">${escapeHtml(fmt(points))}</span>`
  const sub = detail
    ? `<div style="color:${FAINT};font-size:11px;line-height:1.4;margin-top:1px">${escapeHtml(detail)}</div>`
    : ''
  return (
    `<tr><td style="padding:3px 0;font-size:13px;line-height:1.4;color:${TEXT}">` +
    `${escapeHtml(label)}${sub}</td>` +
    `<td align="right" style="padding:3px 0;font-size:13px;vertical-align:top">${pts}</td></tr>`
  )
}

/**
 * Sub-line for an asset before any points exist.
 *
 * Shows last season under THIS league's scoring, with games played attached so a
 * 12-game season is never read as a full one, and the market price for a pick
 * that has not been drafted. Position alone when we measured nothing.
 */
function priorDetail(asset: AssetExpectation | undefined, fallback: string | null): string | null {
  if (!asset) return fallback
  const bits: string[] = []
  if (asset.priorPoints != null) {
    const perGame =
      asset.priorPerGame != null && asset.priorGames != null
        ? ` (${asset.priorPerGame}/gm over ${asset.priorGames})`
        : ''
    bits.push(`${asset.priorPoints} last season${perGame}`)
  }
  if (asset.isPick && asset.marketValue != null) bits.push(`market ${Math.round(asset.marketValue)}`)
  if (bits.length === 0) return fallback
  return fallback ? `${fallback} · ${bits.join(' · ')}` : bits.join(' · ')
}

function assetList(
  players: TradeAsset[],
  picks: TradePickAsset[],
  season: string | null,
  accent: boolean,
  expected?: Map<string, AssetExpectation>,
): string {
  const rows: string[] = []
  for (const p of players) {
    const exp = expected?.get(p.playerId)
    // Before kickoff the credited number is 0.0 for everyone, which tells the
    // manager nothing; last season's real points tell him something.
    const points = expected ? (exp?.priorPoints ?? null) : season ? (p.creditedBySeason[season] ?? 0) : null
    rows.push(assetRow(p.name, priorDetail(exp, p.position), points, accent))
  }
  for (const pick of picks) {
    const base = pick.rerouted
      ? 'traded again before the draft'
      : pick.pending
        ? 'not drafted yet'
        : (pick.resolved?.name ?? null)
    const exp = expected?.get(pick.label)
    const points = expected
      ? null
      : pick.resolved
        ? season
          ? (pick.resolved.creditedBySeason[season] ?? 0)
          : null
        : null
    rows.push(assetRow(pick.label, priorDetail(exp, base), points, accent))
  }
  if (rows.length === 0) rows.push(assetRow('nothing', null, null, accent))
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table>`
}

function columnHeading(text: string, color: string): string {
  return (
    `<div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;` +
    `color:${color};font-weight:700;margin-bottom:6px">${escapeHtml(text)}</div>`
  )
}

function expectationMap(sideExp: SideExpectation | undefined): Map<string, AssetExpectation> | undefined {
  if (!sideExp) return undefined
  const map = new Map<string, AssetExpectation>()
  for (const a of [...sideExp.assetsIn, ...sideExp.assetsOut]) map.set(a.key, a)
  return map
}

/** Positional swing from this trade alone, e.g. "+1 TE · −1 WR · −1 RB". */
function positionDeltaLine(delta: Record<string, number>): string | null {
  const parts = Object.entries(delta)
    .sort((a, b) => b[1] - a[1])
    .map(([pos, n]) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${pos}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function sideCard(side: TradeSideGrade, provisional: boolean, sideExp?: SideExpectation): string {
  const m = sideMath(side)
  // A projected letter keeps its grade colour so it reads at a glance, but never
  // without the word PROJECTED under it — the colour carries the signal, the
  // label carries the caveat. With no projection, a neutral dash beats a fake C.
  const projected = provisional ? (sideExp?.projected ?? null) : null
  const colors = projected
    ? GRADE_COLORS[projected.letter]
    : provisional
      ? PROVISIONAL_COLORS
      : GRADE_COLORS[side.initialGrade]
  const chipLabel = projected ? projected.letter : provisional ? '–' : side.initialGrade
  const who = side.teamName ? `${side.managerName} · ${side.teamName}` : side.managerName
  const expected = expectationMap(sideExp)

  let netLine: string
  if (!provisional) {
    netLine =
      `Got <span style="color:${TEXT};font-weight:600">${escapeHtml(fmt(m.got))}</span> · ` +
      `Gave <span style="color:${TEXT};font-weight:600">${escapeHtml(fmt(m.gave))}</span> · ` +
      `Net <span style="color:${TEXT};font-weight:700">${escapeHtml(signed(m.net))}</span>`
  } else if (sideExp && (sideExp.marketNet != null || sideExp.priorNet != null)) {
    const bits: string[] = []
    if (sideExp.marketNet != null) {
      bits.push(
        `Market <span style="color:${TEXT};font-weight:700">${escapeHtml(signed(sideExp.marketNet))}</span>`,
      )
    }
    if (sideExp.priorNet != null) {
      bits.push(
        `Last season <span style="color:${TEXT};font-weight:700">${escapeHtml(signed(sideExp.priorNet))}</span>`,
      )
    }
    const posLine = positionDeltaLine(sideExp.positionDelta)
    if (posLine) bits.push(`<span style="color:${FAINT}">${escapeHtml(posLine)}</span>`)
    netLine = bits.join(' · ')
  } else {
    netLine = `<span style="color:${FAINT}">no points credited yet</span>`
  }

  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CARD};border:1px solid ${BORDER};border-radius:14px;margin-bottom:12px">
  <tr>
    <td style="padding:14px 16px 10px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="font-size:15px;font-weight:700;color:${TEXT};line-height:1.3">${escapeHtml(who)}</td>
          <td align="right" style="width:70px">
            <div style="display:inline-block;min-width:26px;padding:4px 9px;background:${colors.bg};color:${colors.fg};border-radius:8px;font-size:15px;font-weight:800;text-align:center">${escapeHtml(chipLabel)}</div>
            ${
              projected
                ? `<div style="font-size:8px;letter-spacing:0.09em;color:${FAINT};font-weight:700;margin-top:3px;text-align:center">PROJECTED</div>`
                : ''
            }
          </td>
        </tr>
      </table>
      <div style="font-size:11px;color:${MUTED};margin-top:5px">${netLine}</div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 16px 14px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td width="50%" valign="top" style="padding-right:8px">
            ${columnHeading('Got', GOT_ACCENT)}
            ${assetList(side.playersIn, side.picksIn, m.season, true, expected)}
          </td>
          <td width="50%" valign="top" style="padding-left:8px;border-left:1px solid ${BORDER}">
            ${columnHeading('Gave', MUTED)}
            ${assetList(side.playersOut, side.picksOut, m.season, false, expected)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

/**
 * The "why" strip. Every sentence is derived from the payload, never asserted.
 */
export function explainGrade(
  trade: GradedTrade,
  provisional: boolean,
  expectation?: TradeExpectation | null,
): string {
  if (provisional && expectation?.available) {
    const pending = unresolvedPickLabels(trade)
    const scoringNote =
      expectation.scoringMode === 'format-approx'
        ? ' scored with a format approximation rather than the league weights'
        : " scored with this league's own settings"

    const perSide = expectation.sides
      .map((s) => {
        const bits: string[] = []
        if (s.priorIn != null && s.priorOut != null) {
          bits.push(`took ${fmt(s.priorIn)} against ${fmt(s.priorOut)} given up`)
        }
        if (s.marketNet != null) bits.push(`market value ${signed(s.marketNet)}`)
        return bits.length > 0 ? `${s.managerName} ${bits.join(', ')}` : null
      })
      .filter((v): v is string => v != null)

    const gapNote = expectation.sides
      .filter((s) => s.starterGaps && s.starterGaps.length > 0)
      .map(
        (s) =>
          `${s.managerName} cannot fill ${s.starterGaps!
            .map((g) => `${g.position} (${g.rostered} of ${g.required})`)
            .join(' and ')}`,
      )
      .join('; ')

    const projected = expectation.sides.filter((s) => s.projected != null)
    const anyProjection = projected[0]?.projected ?? null

    // Caveats sit beside the letter rather than in a footnote, because each one
    // describes a case where the letter would otherwise be read as harder than
    // the evidence supports.
    const noiseNote = anyProjection?.insideNoise
      ? `The gap between the two sides is smaller than the uncertainty in the valuations themselves${
          anyProjection.uncertainty != null ? ` (±${Math.round(anyProjection.uncertainty)})` : ''
        }, so this grades as a fair deal rather than a win for anybody. `
      : ''

    const disagreeing = projected.find((s) => s.projected!.productionDisagrees)
    const disagreeNote =
      disagreeing && !anyProjection?.insideNoise
        ? `Last season's raw totals point the other way, so treat this as one of two signals rather than a verdict — totals also favour whoever received more players, which value does not. `
        : ''

    const edgeNote = projected
      .filter((s) => s.projected!.valueEdge > 0)
      .map(
        (s) =>
          `${s.managerName} came out ahead on value by ${Math.abs(Math.round(s.projected!.valueEdge * 100))}%`,
      )
      .join('; ')

    const lead = projected.length
      ? `No games have been played yet, so these letters are projections rather than results — graded on market value for this league, which prices a star correctly against two useful pieces. `
      : `No games have been played yet, so the letter stays open — but the trade is not unknowable. `

    return (
      lead +
      `This is a ${expectation.leagueNote} league. ` +
      (edgeNote ? `${edgeNote}. ` : '') +
      (expectation.priorSeason
        ? `For reference, ${expectation.priorSeason} production${scoringNote}: ${perSide.join('; ')}. `
        : `${perSide.join('; ')}. `) +
      noiseNote +
      disagreeNote +
      (gapNote ? `Roster needs: ${gapNote}. ` : '') +
      (pending.length > 0
        ? `${pending.join(' and ')} ${pending.length > 1 ? 'are' : 'is'} priced at market because ${pending.length > 1 ? 'they have' : 'it has'} not been drafted. `
        : '') +
      `The letters re-grade from real points as the season runs.`
    )
  }

  if (provisional) {
    const pending = unresolvedPickLabels(trade)
    const pickNote =
      pending.length > 0
        ? ` ${pending.join(' and ')} ${pending.length > 1 ? 'have' : 'has'} not been drafted yet, so ${pending.length > 1 ? 'they' : 'it'} cannot count toward anything until the draft resolves.`
        : ''
    return (
      'No games have been played since this trade, so every asset is credited 0.0 points and both nets are exactly zero. ' +
      'The engine grades on points actually scored while you hold an asset — with nothing scored, it has no opinion yet.' +
      pickNote +
      ' It re-grades on its own as real points come in.'
    )
  }

  const parts = trade.sides.map((side) => {
    const m = sideMath(side)
    return `${side.managerName} netted ${signed(m.net)} (got ${fmt(m.got)}, gave ${fmt(m.gave)}) → ${side.initialGrade}`
  })
  return (
    `${parts.join('. ')}. ` +
    'Grades count only the points an asset scored while actually on the roster, and re-grade every season.'
  )
}

function gradeBands(provisional: boolean): string {
  if (!provisional) return ''
  return (
    `<div style="font-size:11px;color:${FAINT};line-height:1.6;margin-top:8px">` +
    `The scale, for reference: <b style="color:${MUTED}">A</b> net ≥ 100 · ` +
    `<b style="color:${MUTED}">B</b> ≥ 40 · <b style="color:${MUTED}">C</b> −40 to 40 · ` +
    `<b style="color:${MUTED}">D</b> −100 to −40 · <b style="color:${MUTED}">F</b> below −100. ` +
    `A zero-point trade sits in the middle of C, which is why an ungraded trade would otherwise look average.` +
    `</div>`
  )
}

export type TradeGradeEmail = { subject: string; html: string }

/**
 * How these managers have traded before.
 *
 * Deliberately its own card, placed AFTER the grade reasoning. The grade is
 * arithmetic on player values; a trading pattern is a different kind of claim,
 * and blending the two would let a reputation quietly colour a number the reader
 * takes as objective. Anyone who has not traded enough to have a pattern is said
 * to have no pattern, not described as unremarkable.
 */
function psychologyCard(psychology: TradePsychologyContext | null): string {
  if (!psychology) return ''

  const rows = psychology.sides
    .map((side) => {
      const body =
        side.labels.length > 0
          ? `<span style="color:${TEXT};font-weight:600">${escapeHtml(side.labels.join(' · '))}</span>` +
            `<span style="color:${FAINT}"> — from ${side.tradeEvidenceCount} recorded trade action${
              side.tradeEvidenceCount === 1 ? '' : 's'
            }${side.confidence ? `, ${escapeHtml(side.confidence)} confidence` : ''}</span>`
          : `<span style="color:${FAINT}">${escapeHtml(side.shortfall ?? 'Not enough trading history yet.')}</span>`
      return `<div style="font-size:13px;line-height:1.6;color:${MUTED};margin-bottom:4px">${escapeHtml(
        side.managerName
      )}: ${body}</div>`
    })
    .join('')

  return `
    <tr>
      <td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;margin-top:12px">
        <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700;margin-bottom:6px">
          How these managers trade
        </div>
        ${rows}
        <div style="font-size:11px;color:${FAINT};line-height:1.5;margin-top:8px">
          Based on past trades in this league. This did not affect the grade above.
        </div>
      </td>
    </tr>`
}

/**
 * 22a — the verdict block. THREE explicit lines, never collapsed into prose.
 *
 * ⚠ THIS IS A COPY CONTRACT, NOT A LAYOUT PREFERENCE. Value edge, uncertainty
 * and the plain-language grade are three different claims with three different
 * strengths, and a sentence that runs them together lets a reader take the
 * weakest one as confidently as the strongest. So: one labelled row each.
 *
 * The numbers come from `ProjectedGrade`, which already carries `valueEdge`,
 * `uncertainty` and `letter` — nothing here computes a grade.
 */
function verdictBlock(sides: TradeSideGrade[], expectation: TradeExpectation | null): string {
  if (!expectation) return ''
  const bySideId = new Map(expectation.sides.map((s) => [s.rosterId, s]))

  const rows = sides
    .map((side) => {
      const exp = bySideId.get(side.rosterId)
      const p = exp?.projected
      if (!p) return null

      const edgePct = Math.round(p.valueEdge * 100)
      const edgeText =
        edgePct === 0
          ? 'even'
          : `${edgePct > 0 ? '+' : ''}${edgePct}% ${edgePct > 0 ? 'in their favour' : 'against them'}`

      /*
       * Uncertainty is printed in the same units as the value net, as a ±. When
       * the edge does not clear it, the row says so outright — an edge inside
       * the noise is not an edge, and `insideNoise` already knows.
       */
      const uncertaintyText =
        p.uncertainty == null
          ? 'not measurable — only one source priced these assets'
          : `± ${fmt(p.uncertainty)} value${p.insideNoise ? ' — the edge does not clear it' : ''}`

      const plain = p.insideNoise
        ? 'Too close to call. Both sides can defend this one.'
        : p.productionDisagrees
          ? 'Value and last season’s production disagree, so neither is strong enough to assert alone.'
          : edgePct >= 25
            ? 'A clear win on value.'
            : edgePct >= 10
              ? 'A modest edge on value.'
              : edgePct <= -25
                ? 'A clear loss on value.'
                : edgePct <= -10
                  ? 'A modest loss on value.'
                  : 'A fair deal on value.'

      return `
<tr>
  <td style="padding:9px 0;border-top:1px solid ${BORDER}">
    <div style="font-size:12px;font-weight:700;color:${TEXT};margin-bottom:5px">${escapeHtml(side.managerName)} &middot; ${escapeHtml(p.letter)}</div>
    <div style="font-size:11px;color:${MUTED};line-height:1.7">
      <span style="color:${FAINT}">Value edge</span> &nbsp;${escapeHtml(edgeText)}<br>
      <span style="color:${FAINT}">Uncertainty</span> &nbsp;${escapeHtml(uncertaintyText)}<br>
      <span style="color:${FAINT}">In plain terms</span> &nbsp;${escapeHtml(plain)}
    </div>
  </td>
</tr>`
    })
    .filter(Boolean)

  if (rows.length === 0) return ''

  return `
<tr>
  <td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px">
    <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700;margin-bottom:2px">
      The verdict
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.join('')}</table>
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`
}

/**
 * 22a — the roster-needs callout.
 *
 * ⚠ ONLY RENDERED WHEN THERE IS A REAL POSITIONAL GAP. The handoff is explicit
 * that this must not be forced into every email. `starterGaps` is null when we
 * could not read rosters at all, and an empty array means we read them and found
 * nothing — those are different, and neither produces a callout.
 */
function rosterNeedsBlock(expectation: TradeExpectation | null): string {
  if (!expectation) return ''
  const lines = expectation.sides
    .map((side) => {
      const gaps = side.starterGaps
      if (!gaps || gaps.length === 0) return null
      const text = gaps.map((g) => `${g.position} (${g.rostered} of ${g.required})`).join(', ')
      return `<div style="font-size:11px;color:${MUTED};line-height:1.6;margin-top:4px">${escapeHtml(side.managerName)} cannot fill: ${escapeHtml(text)}</div>`
    })
    .filter(Boolean)

  if (lines.length === 0) return ''

  return `
<tr>
  <td style="padding:12px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px">
    <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700">
      What this leaves behind
    </div>
    ${lines.join('')}
  </td>
</tr>
<tr><td style="height:12px"></td></tr>`
}

/**
 * 22a — the forward-looking risk line.
 *
 * ⚠ A TRUST COMMITMENT, NOT OPTIONAL COLOUR. Every grade here is a snapshot of
 * today's information, and the honest thing is to name the specific way it could
 * age badly rather than to imply the letter is final. The line is DERIVED — a
 * future pick, an unpriced asset, a single-source valuation — so it is never a
 * generic hedge glued onto the bottom.
 */
function forwardRiskLine(trade: GradedTrade, expectation: TradeExpectation | null): string | null {
  if (!expectation) return null

  const allAssets = expectation.sides.flatMap((s) => [...s.assetsIn, ...s.assetsOut])
  const picks = allAssets.filter((a) => a.isPick)
  const unpriced = allAssets.filter((a) => a.marketValue == null)
  const thinlySourced = allAssets.filter((a) => a.valueSources.length === 1)

  if (picks.length > 0) {
    return (
      `${picks.length === 1 ? 'A future pick is' : `${picks.length} future picks are`} in this deal, ` +
      `priced at today's expectation of where ${picks.length === 1 ? 'it' : 'they'} will land. ` +
      `One bad season by the team that owes ${picks.length === 1 ? 'it' : 'them'} and this grade ages badly.`
    )
  }
  if (unpriced.length > 0) {
    return (
      `${unpriced.length} ${unpriced.length === 1 ? 'asset carries' : 'assets carry'} no market price at all, ` +
      `so ${unpriced.length === 1 ? 'it is' : 'they are'} counted as zero above. If that is wrong, the edge is wrong.`
    )
  }
  if (thinlySourced.length > 0) {
    return (
      `${thinlySourced.length} ${thinlySourced.length === 1 ? 'asset was' : 'assets were'} priced by a single source, ` +
      `with nothing to corroborate ${thinlySourced.length === 1 ? 'it' : 'them'}. Treat the edge as softer than it looks.`
    )
  }
  return `Grades move. This one is scored on ${trade.season} information, and a season of production can reverse it.`
}

/**
 * 22a — the footer, including the PER-LEAGUE mute.
 *
 * ⚠ A GLOBAL UNSUBSCRIBE IS NOT ENOUGH AT 61 LEAGUES, and that is the whole
 * point of this contract. Someone who wants one noisy league to stop should not
 * have to choose between it and every trade email they actually want.
 *
 * ⚠ THE MUTE LINK GOES TO SETTINGS, NOT TO A ONE-CLICK ENDPOINT, AND THAT IS A
 * KNOWN GAP. There is no per-user-per-league notification store in this repo —
 * `lib/league/league-notification-prefs.ts` is a LEAGUE-wide toggle a
 * commissioner sets, not a personal mute. So the link lands on the real
 * notifications settings page with the league in the query rather than on an
 * endpoint that does not exist. When a per-user store lands, this becomes a
 * signed one-click URL like the global unsubscribe beside it.
 */
function emailFooter(params: {
  baseUrl: string
  leagueName: string
  leagueId: string | null
  /** Signed global unsubscribe URL. Omitted when we cannot mint one. */
  unsubscribeUrl: string | null
}): string {
  const muteHref = params.leagueId
    ? `${params.baseUrl}/settings?tab=notifications&league=${encodeURIComponent(params.leagueId)}`
    : `${params.baseUrl}/settings?tab=notifications`
  const link = (href: string, text: string) =>
    `<a href="${escapeHtml(href)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(text)}</a>`

  return `
<tr>
  <td style="padding-top:16px;border-top:1px solid ${BORDER};color:${FAINT};font-size:11px;line-height:1.7">
    AllFantasy.ai<br>
    ${link(muteHref, `Mute ${params.leagueName}`)}
    &nbsp;&middot;&nbsp;
    ${link(`${params.baseUrl}/settings?tab=notifications`, 'Change preferences')}
    ${params.unsubscribeUrl ? `&nbsp;&middot;&nbsp;${link(params.unsubscribeUrl, 'Unsubscribe from all')}` : ''}
  </td>
</tr>`
}

export function buildTradeGradeEmail(params: {
  leagueName: string
  trade: GradedTrade
  ledgerUrl: string
  /** League/scoring/prior-season/roster context. Omit and the email says only what points prove. */
  expectation?: TradeExpectation | null
  /**
   * How these managers have traded before. CONTEXT ONLY — it never touches the
   * grade, and is rendered in its own card below the reasoning so a reader can
   * see it is a separate claim. Omit it and the email is exactly as it was.
   */
  psychology?: TradePsychologyContext | null
  /**
   * 22a — footer controls. Absolute origin, because an email has no page to be
   * relative to; a root-relative href in an inbox resolves against the mail
   * client's own domain and 404s.
   */
  baseUrl?: string
  /** Powers the per-league mute link. Omit and the footer links to settings. */
  leagueId?: string | null
  /** Signed global unsubscribe URL. Omit and that link is left out entirely. */
  unsubscribeUrl?: string | null
}): TradeGradeEmail {
  const { leagueName, trade, ledgerUrl } = params
  /*
   * Falls back to the ledger's own origin. That URL is already absolute and
   * already points at us, so it is a safer default than a hardcoded domain that
   * would be wrong in every preview and staging environment.
   */
  const baseUrl = params.baseUrl ?? (() => {
    try {
      return new URL(ledgerUrl).origin
    } catch {
      return ''
    }
  })()
  const provisional = hasNoSignal(trade)
  const expectation = params.expectation?.available ? params.expectation : null
  const psychology = params.psychology?.available ? params.psychology : null

  const bySideId = new Map((expectation?.sides ?? []).map((s) => [s.rosterId, s]))
  const projections = provisional
    ? trade.sides
        .map((s) => ({ name: s.managerName, p: bySideId.get(s.rosterId)?.projected ?? null }))
        .filter((x): x is { name: string; p: NonNullable<typeof x.p> } => x.p != null)
    : []

  /*
   * ⚠ THE SUBJECT NEVER HIDES THE NEWS — league name AND the players involved,
   * in the subject line itself. At 61 leagues an inbox full of "Trade completed"
   * is unreadable, and the manager should not have to open the mail to find out
   * whether it concerns anyone they care about.
   *
   * Capped at four names so a twelve-player deal does not produce a subject line
   * that gets truncated into meaninglessness by the mail client.
   */
  const headlineNames = (() => {
    const names: string[] = []
    for (const side of trade.sides) {
      for (const a of side.playersIn) {
        if (a.name && !names.includes(a.name)) names.push(a.name)
      }
    }
    if (names.length === 0) return ''
    const shown = names.slice(0, 4)
    const extra = names.length - shown.length
    return `${shown.join(', ')}${extra > 0 ? ` +${extra}` : ''}`
  })()
  const namePart = headlineNames ? ` \u2014 ${headlineNames}` : ''

  // The subject must carry the same caveat as the body. A letter that looks
  // realized in the inbox is not rescued by a disclaimer further down.
  const subjectCore = !provisional
    ? `Trade completed in ${leagueName} — initial grades: ${trade.sides
        .map((s) => `${s.managerName} ${s.initialGrade}`)
        .join(', ')}`
    : projections.length === trade.sides.length && expectation?.priorSeason
      ? `Trade completed in ${leagueName} — projected on ${expectation.priorSeason}: ${projections
          .map((x) => `${x.name} ${x.p.letter}`)
          .join(', ')}`
      : `Trade completed in ${leagueName} — too early to grade (no games played yet)`
  const subject = `${subjectCore}${namePart}`
  const cards = trade.sides
    .map((s) => sideCard(s, provisional, provisional ? bySideId.get(s.rosterId) : undefined))
    .join('')
  const statusLine = provisional
    ? projections.length > 0 && expectation?.priorSeason
      ? `Projected on ${expectation.priorSeason} production · no games played yet`
      : 'Too early to grade'
    : trade.tie
      ? 'Dead even so far'
      : 'Initial grades'

  const forwardRisk = forwardRiskLine(trade, expectation)

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="background:${BG};padding:24px 12px;font-family:${FONT};color:${TEXT}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto">
    <tr>
      <td style="padding-bottom:14px">
        <div style="font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:${FAINT};font-weight:700">
          Trade completed · ${escapeHtml(trade.season)} week ${escapeHtml(String(trade.week))}
        </div>
        <div style="font-size:21px;font-weight:800;color:${TEXT};margin-top:5px;line-height:1.25">
          ${escapeHtml(leagueName)}
        </div>
        <div style="font-size:13px;color:${MUTED};margin-top:3px">${escapeHtml(statusLine)}</div>
        ${
          expectation
            ? `<div style="font-size:11px;color:${FAINT};margin-top:6px">${escapeHtml(expectation.leagueNote)}</div>`
            : ''
        }
      </td>
    </tr>
    <tr><td>${cards}</td></tr>
    ${verdictBlock(trade.sides, expectation)}
    ${rosterNeedsBlock(expectation)}
    <tr>
      <td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px">
        <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700;margin-bottom:6px">
          ${provisional && expectation ? 'What we can tell before kickoff' : 'Why this grade'}
        </div>
        <div style="font-size:13px;line-height:1.6;color:${MUTED}">
          ${escapeHtml(explainGrade(trade, provisional, expectation))}
        </div>
        ${gradeBands(provisional)}
        ${
          expectation && expectation.missing.length > 0
            ? `<div style="font-size:11px;color:${FAINT};line-height:1.5;margin-top:8px">Not factored in: ${escapeHtml(expectation.missing.join('; '))}.</div>`
            : ''
        }
      </td>
    </tr>
    <tr><td style="height:12px"></td></tr>
    ${
      forwardRisk
        ? `<tr>
      <td style="padding:11px 14px;border:1px solid ${BORDER};border-radius:12px">
        <div style="font-size:10px;letter-spacing:0.09em;text-transform:uppercase;color:${FAINT};font-weight:700;margin-bottom:4px">How this could age badly</div>
        <div style="font-size:11.5px;line-height:1.6;color:${MUTED}">${escapeHtml(forwardRisk)}</div>
      </td>
    </tr>
    <tr><td style="height:12px"></td></tr>`
        : ''
    }
    ${psychologyCard(psychology)}
    <tr>
      <td align="center" style="padding:20px 0 6px 0">
        <a href="${escapeHtml(ledgerUrl)}" style="display:inline-block;background:#ffffff;color:#0b0b0f;text-decoration:none;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px">
          See the full breakdown
        </a>
        <div style="font-size:11px;color:${FAINT};margin-top:9px">
          Every season, every asset, and the points behind each letter.
        </div>
      </td>
    </tr>
    ${emailFooter({
      baseUrl,
      leagueName,
      leagueId: params.leagueId ?? null,
      unsubscribeUrl: params.unsubscribeUrl ?? null,
    })}
  </table>
</div>
</body>
</html>`

  return { subject, html }
}
