/**
 * The Guilly survival board: the Matchup tab of a guillotine league, for every sport and for both a league
 * hosted here and an imported one (owner's call, 2026-11-24 — "it's me vs the league to not be the lowest
 * scorer", so a head-to-head card is the wrong screen).
 *
 * One view-model, two feeds, so the screen cannot differ by where the league lives:
 *   - native   → `/api/leagues/[id]/guillotine/summary` (the chop engine's own tiers, scores and chops);
 *   - imported → `/api/leagues/[id]/guillotine/imported` (the provider's weekly scores, ./importedGuillyView.ts).
 *
 * The board leads with ONE number — the viewer's gap to the chop line — then the line itself, the two teams
 * either side of the viewer, and the graveyard. Pure; no fetching, no rules of its own: every tier comes
 * from the engine (native) or the imported view's rule, exactly as served.
 */
import { buildChopLine, type DangerTierRow } from '@/components/guillotine/guillotineHomeModel'
import type { ImportedGuillyViewData } from './importedGuillyView'

export type BoardTier = 'safe' | 'danger' | 'chop_zone'

export type BoardRow = {
  rosterId: string
  name: string
  /** This week's score; null before it has one. */
  points: number | null
  tier: BoardTier
  isMe: boolean
  /** Last week's top scorer: this week's chop cannot take it (native only). */
  immune: boolean
  /** Draw the chop line directly above this row (the first chop-zone row). */
  cutAbove: boolean
  /** 0–100 along the score strip; null until the field has scores. */
  trackPct: number | null
}

export type BoardStatus = 'pre_scores' | 'safe' | 'danger' | 'chop_zone' | 'immune' | 'chopped' | 'spectator'

export type SurvivalBoard = {
  source: 'native' | 'imported'
  week: number | null
  alive: number
  /** Teams chopped this week (1 classic; 0 a no-chop week; 2+ a double chop). */
  chopCount: number
  scored: boolean
  /** The score a team must beat to be safe: the best score in the chop zone. */
  cutScore: number | null
  /** The lowest score above the line: what a team in the chop zone must pass. */
  safeScore: number | null
  /** 0–100 along the score strip where the blade is drawn (between the zone and the field). */
  bladePct: number | null
  rows: BoardRow[]
  me: BoardRow | null
  status: BoardStatus
  /** Signed distance to the line: positive = cushion above it, negative = points needed to climb out. */
  gap: number | null
  headline: string
  detail: string
  /** The team directly above and directly below the viewer — the race that decides the week. */
  above: BoardRow | null
  below: BoardRow | null
  /** Chopped teams, oldest chop first. */
  graveyard: Array<{ rosterId: string; name: string; week: number | null; isMe: boolean }>
  /** "By Wednesday 7:00 AM ET"-style label for when the chop runs; null when unknown. */
  chopLabel: string | null
}

const round1 = (n: number) => Math.round(n * 10) / 10
export const fmtPts = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—')

type Shared = {
  source: SurvivalBoard['source']
  week: number | null
  chopCount: number
  rows: Array<Omit<BoardRow, 'cutAbove' | 'trackPct'>>
  myRosterId: string | null
  graveyard: SurvivalBoard['graveyard']
  chopLabel: string | null
}

function finish(s: Shared): SurvivalBoard {
  // Highest score first; a team with no score yet sits below every scored team. The engine's tier decides
  // which side of the line a row is on, so the line is drawn above the first chop-zone row.
  const rows0 = [...s.rows].sort((a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity) || a.name.localeCompare(b.name))
  // Chop-zone rows go last so the line sits between the field and the zone, whatever the order of scores.
  const ordered = [...rows0.filter((r) => r.tier !== 'chop_zone'), ...rows0.filter((r) => r.tier === 'chop_zone')]
  const scoredPts = ordered.map((r) => r.points).filter((p): p is number => p != null)
  const scored = scoredPts.some((p) => p > 0)
  const hi = scored ? Math.max(...scoredPts) : 0
  const lo = scored ? Math.min(...scoredPts) : 0
  let cutDrawn = false
  const rows: BoardRow[] = ordered.map((r) => {
    const cutAbove = scored && r.tier === 'chop_zone' && !cutDrawn
    if (cutAbove) cutDrawn = true
    const trackPct = scored && r.points != null ? (hi > lo ? ((r.points - lo) / (hi - lo)) * 100 : 50) : null
    return { ...r, cutAbove, trackPct }
  })
  const zone = rows.filter((r) => r.tier === 'chop_zone' && r.points != null)
  const safe = rows.filter((r) => r.tier !== 'chop_zone' && r.points != null)
  const cutScore = scored && zone.length ? Math.max(...zone.map((r) => r.points as number)) : null
  const safeFloor = scored && safe.length ? Math.min(...safe.map((r) => r.points as number)) : null
  const zoneTop = zone.length ? Math.max(...zone.map((r) => r.trackPct ?? 0)) : null
  const safeBottom = safe.length ? Math.min(...safe.map((r) => r.trackPct ?? 100)) : null
  const bladePct = zoneTop == null ? null : safeBottom == null ? Math.min(100, zoneTop + 4) : (zoneTop + safeBottom) / 2

  const me = rows.find((r) => r.isMe) ?? null
  const myGrave = s.myRosterId ? s.graveyard.find((g) => g.rosterId === s.myRosterId) ?? null : null
  const idx = me ? rows.indexOf(me) : -1
  const above = idx > 0 ? rows[idx - 1] : null
  const below = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null

  let status: BoardStatus
  let gap: number | null = null
  if (myGrave) status = 'chopped'
  else if (!me) status = 'spectator'
  else if (!scored) status = me.immune ? 'immune' : 'pre_scores'
  else if (me.immune) status = 'immune'
  else status = me.tier

  if (me && scored && me.points != null) {
    if (me.tier === 'chop_zone' && safeFloor != null) gap = round1(me.points - safeFloor)
    else if (cutScore != null) gap = round1(me.points - cutScore)
  }

  const alive = rows.length
  const chopWord = s.chopCount === 0 ? 'No chop this week' : s.chopCount > 1 ? `${s.chopCount} teams get chopped this week` : 'The lowest score gets chopped'
  const wk = s.week != null ? `Week ${s.week}` : 'This week'
  let headline: string
  let detail: string
  switch (status) {
    case 'chopped':
      headline = myGrave?.week != null ? `You were chopped in week ${myGrave.week}` : 'You were chopped'
      detail = `${alive} ${alive === 1 ? 'team is' : 'teams are'} still alive. Follow the race to the last team standing.`
      break
    case 'spectator':
      headline = `${alive} teams alive`
      detail = `${wk}. ${chopWord}.`
      break
    case 'pre_scores':
      headline = s.chopCount === 0 ? 'No chop this week' : "Don't finish last this week"
      detail = s.chopCount === 0 ? 'No scores yet. Nobody is chopped this week.' : `No scores yet. ${chopWord} when ${s.week != null ? `week ${s.week}` : 'the week'} ends, so every point counts.`
      break
    case 'immune':
      headline = "You're immune this week"
      detail = "You had last week's top score, so this week's chop can't take you."
      break
    case 'chop_zone':
      headline = gap != null ? `${fmtPts(Math.abs(gap))} pts from safety` : "You're on the chopping block"
      detail = above ? `Pass ${above.name} (${fmtPts(above.points)}) to get above the chop line.` : 'Score more to get above the chop line.'
      break
    case 'danger':
      headline = gap != null ? `Only ${fmtPts(gap)} above the chop line` : 'Too close to the chop line'
      detail = below ? `${below.name} is ${fmtPts(Math.max(0, (me?.points ?? 0) - (below.points ?? 0)))} behind you.` : 'One bad night drops you into the chop zone.'
      break
    default:
      headline = gap != null ? `Safe by ${fmtPts(gap)}` : "You're safe"
      detail = `${Math.max(0, rows.length - 1 - idx)} ${rows.length - 1 - idx === 1 ? 'team is' : 'teams are'} below you. Chop line: ${fmtPts(cutScore)}.`
  }

  return {
    source: s.source,
    week: s.week,
    alive,
    chopCount: s.chopCount,
    scored,
    cutScore,
    safeScore: safeFloor,
    bladePct,
    rows,
    me,
    status,
    gap,
    headline,
    detail,
    above,
    below,
    graveyard: [...s.graveyard].sort((a, b) => (a.week ?? 0) - (b.week ?? 0) || a.name.localeCompare(b.name)),
    chopLabel: s.chopLabel,
  }
}

/** The native summary, as `/api/leagues/[id]/guillotine/summary` serves it (fields the board reads). */
export type NativeBoardSummary = {
  weekOrPeriod?: number | null
  myRosterId?: string | null
  dangerTiers?: DangerTierRow[] | null
  chopWatch?: { week: number; chopCount: number; chopLine: number | null } | null
  home?: {
    scores?: Record<string, number> | null
    chopLabel?: string | null
    chopped?: ReadonlyArray<{ rosterId: string; name: string; week: number | null; points: number | null }> | null
  } | null
}

export function boardFromNativeSummary(summary: NativeBoardSummary): SurvivalBoard {
  const me = summary.myRosterId ?? null
  const line = buildChopLine(summary.dangerTiers ?? [], me, summary.home?.scores ?? null)
  return finish({
    source: 'native',
    week: summary.chopWatch?.week ?? summary.weekOrPeriod ?? null,
    chopCount: summary.chopWatch?.chopCount ?? 1,
    rows: line.rows.map((r) => ({ rosterId: r.rosterId, name: r.name, points: r.points, tier: r.tier, isMe: r.isMe, immune: r.immune })),
    myRosterId: me,
    graveyard: (summary.home?.chopped ?? []).map((c) => ({ rosterId: c.rosterId, name: c.name?.trim() || 'A team', week: c.week ?? null, isMe: !!me && c.rosterId === me })),
    chopLabel: summary.home?.chopLabel ?? null,
  })
}

export function boardFromImportedView(view: ImportedGuillyViewData, myRosterId: string | null | undefined): SurvivalBoard {
  const me = myRosterId ?? null
  return finish({
    source: 'imported',
    week: view.week,
    chopCount: 1,
    rows: view.standings.map((s) => ({
      rosterId: s.rosterId,
      name: s.name,
      points: view.scoredThisWeek > 0 ? s.points : null,
      tier: s.tier ?? 'safe',
      isMe: !!me && s.rosterId === me,
      immune: false,
    })),
    myRosterId: me,
    graveyard: view.chopped.map((c) => ({ rosterId: c.rosterId, name: c.name, week: c.week, isMe: !!me && c.rosterId === me })),
    chopLabel: null,
  })
}
