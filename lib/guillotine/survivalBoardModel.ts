/**
 * The Guilly survival board: the Chop page of a guillotine league, for every sport and for both a league
 * hosted here and an imported one (owner's call, 2026-11-24 — "it's me vs the league to not be the lowest
 * scorer", so a head-to-head card is the wrong screen; and 2026-11-25 — it is the league's ONE list, so the
 * hub's second chop line is gone and this board is what the Chop tab opens on).
 *
 * One view-model, three feeds, so the screen cannot differ by where the league lives or which week is open:
 *   - native   → `/api/leagues/[id]/guillotine/summary` (the chop engine's own tiers, scores and chops);
 *   - imported → `/api/leagues/[id]/guillotine/imported` (the provider's weekly scores, ./importedGuillyView.ts);
 *   - a past week → the summary's own `home.history` (./survivalHistory.ts), the chop's inputs and output.
 *
 * The board leads with ONE number — the viewer's gap to the chop line — then the line itself, the two teams
 * either side of the viewer, and the graveyard. Pure; no fetching, no rules of its own: every tier comes
 * from the engine (native) or the imported view's rule, exactly as served.
 *
 * Two things here are the board's own, and both are labelled as such on the page:
 *   - the ORDER of the list (./chopListOrder.ts): chop zone on top by default, a commissioner's choice;
 *   - PROJECTED zones before anyone has scored: with a projection for every team alive, the lowest projected
 *     finishers are shown as the projected chop zone so the list is never a blank card six days a week. They
 *     are a forecast and never called the chop line; the engine's tiers replace them at the first point.
 */
import { buildChopLine, ordinal, type DangerTierRow } from '@/components/guillotine/guillotineHomeModel'
import { DEFAULT_CHOP_LIST_ORDER, type ChopListOrder } from './chopListOrder'
import type { ImportedGuillyViewData } from './importedGuillyView'
import type { SurvivalHistory } from './survivalHistory'
import { survivalOdds, type TeamOutlook } from './survivalOutlook'

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
  /** Place in the race, 1 = the best score (or the best projection before any score); null when unranked. */
  rank: number | null
  /** Draw the chop-zone marker directly above this row: the first chop-zone row as the list is ordered. */
  cutAbove: boolean
  /** This row opens a zone (as the list is ordered): the zone's name is drawn above it. Null inside a zone. */
  zoneStart: BoardTier | null
  /** 0–100 along the score strip; null until the field has scores. */
  trackPct: number | null
  /** Starters with a game still to play this week, and those games added up; null when unknown. */
  playersLeft: number | null
  gamesLeft: number | null
  /** Score so far plus the projection for the games left; null without a projection. */
  projectedFinish: number | null
  /** Chance of surviving this week's chop, 0–100; null when the odds cannot be made honestly. */
  safePct: number | null
}

export type BoardStatus = 'pre_scores' | 'safe' | 'danger' | 'chop_zone' | 'immune' | 'chopped' | 'spectator'

export type SurvivalBoard = {
  source: 'native' | 'imported'
  week: number | null
  alive: number
  /** Teams chopped this week (1 classic; 0 a no-chop week; 2+ a double chop). */
  chopCount: number
  scored: boolean
  /** No score yet, and the zones shown are the projection's (see the file header). Never true once scored. */
  projected: boolean
  /** A week that has already been chopped: the scores and the chop are final. */
  final: boolean
  /** Which end of `rows` the chop zone sits at. */
  order: ChopListOrder
  /** The score a team must beat to be safe: the best score in the chop zone. */
  cutScore: number | null
  /** The lowest score above the line: what a team in the chop zone must pass. */
  safeScore: number | null
  /** 0–100 along the score strip where the blade is drawn (between the zone and the field). */
  bladePct: number | null
  /** The list, in the order it is drawn (`order`). */
  rows: BoardRow[]
  me: BoardRow | null
  status: BoardStatus
  /** Signed distance to the line: positive = cushion above it, negative = points needed to climb out. */
  gap: number | null
  headline: string
  detail: string
  /** The team directly above and directly below the viewer BY SCORE — the race that decides the week. */
  above: BoardRow | null
  below: BoardRow | null
  /** Chopped teams, oldest chop first. */
  graveyard: Array<{ rosterId: string; name: string; week: number | null; isMe: boolean }>
  /** "By Wednesday 7:00 AM ET"-style label for when the chop runs; null when unknown. */
  chopLabel: string | null
  /** True when the rows carry % safe. */
  hasOdds: boolean
  /** True when the rows carry players / games left. */
  hasPlayersLeft: boolean
  /** The calendar week being played when it does not count toward a chop (chops start later); else null. */
  notCountingWeek: number | null
}

const round1 = (n: number) => Math.round(n * 10) / 10
export const fmtPts = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—')

/** % safe below which a team that is not in the projected chop zone is still shown in danger. */
const PROJECTED_DANGER_BELOW_PCT = 80

type SharedRow = Pick<BoardRow, 'rosterId' | 'name' | 'points' | 'tier' | 'isMe' | 'immune'>

type Shared = {
  source: SurvivalBoard['source']
  week: number | null
  chopCount: number
  rows: SharedRow[]
  /** Per team, keyed by rosterId (native only, from ./survivalOutlookLoad.ts). */
  outlook?: Record<string, TeamOutlook> | null
  myRosterId: string | null
  graveyard: SurvivalBoard['graveyard']
  chopLabel: string | null
  order?: ChopListOrder
  /** A week already chopped (./survivalHistory.ts): final scores, past-tense copy, no projection. */
  final?: boolean
  /** The calendar week is before the first chop week (./guillotineCurrentWeek.ts): it does not count. */
  notCounting?: { calendarWeek: number; startWeek: number } | null
}

function finish(s: Shared): SurvivalBoard {
  const order = s.order ?? DEFAULT_CHOP_LIST_ORDER
  const final = s.final === true
  // Highest score first; a team with no score yet sits below every scored team. Before any score, the field
  // is ordered by projected finish when there is one (the race as it is expected to run), else by name.
  const projOf = (id: string) => s.outlook?.[id]?.remainingProjection ?? null
  const rows0 = [...s.rows].sort((a, b) =>
    (b.points ?? -Infinity) - (a.points ?? -Infinity) || (projOf(b.rosterId) ?? -Infinity) - (projOf(a.rosterId) ?? -Infinity) || a.name.localeCompare(b.name))
  const scoredPts = rows0.map((r) => r.points).filter((p): p is number => p != null)
  const scored = scoredPts.some((p) => p > 0)
  const hi = scored ? Math.max(...scoredPts) : 0
  const lo = scored ? Math.min(...scoredPts) : 0

  const withOutlook: BoardRow[] = rows0.map((r) => {
    const o = s.outlook?.[r.rosterId] ?? null
    const trackPct = scored && r.points != null ? (hi > lo ? ((r.points - lo) / (hi - lo)) * 100 : 50) : null
    const projectedFinish = o?.remainingProjection != null ? round1((r.points ?? 0) + o.remainingProjection) : null
    return { ...r, rank: null, cutAbove: false, zoneStart: null, trackPct, playersLeft: o ? o.playersLeft : null, gamesLeft: o ? o.gamesLeft : null, projectedFinish, safePct: null }
  })
  // % safe: only when every team alive has an outlook (./survivalOutlook.ts `survivalOdds`).
  const odds = !final && s.outlook && withOutlook.every((r) => s.outlook?.[r.rosterId])
    ? survivalOdds(
        withOutlook.map((r) => ({ rosterId: r.rosterId, current: r.points ?? 0, remainingProjection: s.outlook![r.rosterId]!.remainingProjection, immune: r.immune })),
        s.chopCount,
      )
    : null
  if (odds) for (const r of withOutlook) r.safePct = odds.get(r.rosterId) ?? null

  // Projected zones (file header): before any score, with odds for the whole field and a chop this week, the
  // lowest projected finishers that the chop could take are the projected chop zone. Skipped when immunity
  // leaves too few teams to fill it — the engine skips immunity then, and a forecast must not guess how.
  const canChop = withOutlook.filter((r) => !r.immune)
  const projected = !scored && !final && odds != null && s.chopCount > 0 && canChop.length > s.chopCount
  if (projected) {
    // By projected finish, whatever order the (all-zero or absent) scores left the rows in.
    withOutlook.sort((a, b) => (b.projectedFinish ?? 0) - (a.projectedFinish ?? 0) || a.name.localeCompare(b.name))
    const zone = new Set(withOutlook.filter((r) => !r.immune).slice(-s.chopCount).map((r) => r.rosterId))
    for (const r of withOutlook) r.tier = zone.has(r.rosterId) ? 'chop_zone' : (r.safePct ?? 100) < PROJECTED_DANGER_BELOW_PCT ? 'danger' : 'safe'
  }
  const zoned = scored || projected

  // Best first, the chop zone last: the engine's tier decides which side of the line a row is on, whatever
  // the order of scores (a tiebreak can chop the higher of two level teams).
  const best = [...withOutlook.filter((r) => r.tier !== 'chop_zone'), ...withOutlook.filter((r) => r.tier === 'chop_zone')]
  if (zoned) best.forEach((r, i) => { r.rank = i + 1 })

  const zone = best.filter((r) => r.tier === 'chop_zone' && r.points != null)
  const safe = best.filter((r) => r.tier !== 'chop_zone' && r.points != null)
  const cutScore = scored && zone.length ? Math.max(...zone.map((r) => r.points as number)) : null
  const safeFloor = scored && safe.length ? Math.min(...safe.map((r) => r.points as number)) : null
  const zoneTop = zone.length ? Math.max(...zone.map((r) => r.trackPct ?? 0)) : null
  const safeBottom = safe.length ? Math.min(...safe.map((r) => r.trackPct ?? 100)) : null
  const bladePct = zoneTop == null ? null : safeBottom == null ? Math.min(100, zoneTop + 4) : (zoneTop + safeBottom) / 2

  const me = best.find((r) => r.isMe) ?? null
  const myGrave = s.myRosterId ? s.graveyard.find((g) => g.rosterId === s.myRosterId) ?? null : null
  const idx = me ? best.indexOf(me) : -1
  const above = idx > 0 ? best[idx - 1] : null
  const below = idx >= 0 && idx < best.length - 1 ? best[idx + 1] : null

  // The list as it is drawn. Zone names open each zone; the chop zone's is the marker (`cutAbove`).
  const rows = order === 'chop_top' ? [...best].reverse() : best
  if (zoned) {
    let prev: BoardTier | null = null
    for (const r of rows) {
      if (r.tier !== prev) {
        r.zoneStart = r.tier
        if (r.tier === 'chop_zone') r.cutAbove = true
      }
      prev = r.tier
    }
  }

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

  const alive = best.length
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
      if (projected && me?.rank != null) detail += ` You are projected ${ordinal(me.rank)} of ${alive}.`
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
      detail = `${Math.max(0, best.length - 1 - idx)} ${best.length - 1 - idx === 1 ? 'team is' : 'teams are'} below you. Chop line: ${fmtPts(cutScore)}.`
  }

  /*
   * 🛑 A WEEK THAT DOES NOT COUNT LOOKED LIKE ONE THAT DOES (owner, 2026-11-25). A league that drafts mid-week
   * has its first chop moved to the next full week (lib/guillotine/draftWeekFloor.ts), and a commissioner can
   * set a later first chop. The board then previews the first chop week while the calendar week is still
   * being played, so a manager watching tonight's games saw "No scores yet" for a week that had not started,
   * with nothing saying the current week is a free one.
   */
  const notCountingWeek = s.notCounting && status !== 'chopped' && status !== 'spectator' ? s.notCounting.calendarWeek : null
  if (s.notCounting && notCountingWeek != null) {
    headline = `Chops start in week ${s.notCounting.startWeek}`
    detail = `Week ${s.notCounting.calendarWeek} doesn't count toward a chop. The lowest score in week ${s.notCounting.startWeek} is the first one chopped.`
  }

  // The race is decided by who still has games to play: say so where it matters.
  if (me && me.playersLeft != null && (status === 'chop_zone' || status === 'danger')) {
    const rival = status === 'chop_zone' ? above : below
    detail += ` You have ${me.playersLeft} ${me.playersLeft === 1 ? 'player' : 'players'} left to play${rival && rival.playersLeft != null ? `; ${rival.name} has ${rival.playersLeft}` : ''}.`
  }

  // A week already chopped is told in the past tense, from the same rows: who fell, and how the viewer came through.
  if (final) {
    const fell = best.filter((r) => r.tier === 'chop_zone')
    const fellNames = fell.map((r) => r.name).join(' and ')
    const mine = me && fell.includes(me)
    if (mine) headline = `You were chopped in week ${s.week ?? '—'}`
    else if (me && gap != null && fell.length) headline = gap === 0 ? 'You survived on the tiebreaker' : `You survived by ${fmtPts(gap)}`
    else headline = fell.length ? `${fellNames} ${fell.length === 1 ? 'was' : 'were'} chopped` : 'Nobody was chopped'
    detail = `${wk}, final.${fell.length ? ` Chop line: ${fmtPts(cutScore)}.` : ''}${me && !mine && fell.length ? ` ${fellNames} ${fell.length === 1 ? 'was' : 'were'} chopped.` : ''}`
  }

  return {
    source: s.source,
    week: s.week,
    alive,
    chopCount: s.chopCount,
    scored,
    projected,
    final,
    order,
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
    hasOdds: best.some((r) => r.safePct != null),
    hasPlayersLeft: best.some((r) => r.playersLeft != null),
    notCountingWeek,
  }
}

/** The native summary, as `/api/leagues/[id]/guillotine/summary` serves it (fields the board reads). */
export type NativeBoardSummary = {
  weekOrPeriod?: number | null
  myRosterId?: string | null
  dangerTiers?: DangerTierRow[] | null
  /** The teams alive when there is no chop line yet (after the draft, before a point): ./guillotineField.ts. */
  field?: ReadonlyArray<{ rosterId: string; displayName: string }> | null
  chopWatch?: { week: number; chopCount: number; chopLine: number | null } | null
  outlook?: Record<string, TeamOutlook> | null
  /** The league's calendar week (the summary's `calendarWeek`); behind `weekOrPeriod` before chops start. */
  calendarWeek?: number | null
  home?: {
    scores?: Record<string, number> | null
    chopLabel?: string | null
    chopped?: ReadonlyArray<{ rosterId: string; name: string; week: number | null; points: number | null }> | null
  } | null
  /**
   * The summary's `config`: the first chop week (with `calendarWeek`, whether the week being played counts), and
   * the league's list order (./chopListOrder.ts; absent = the default).
   */
  config?: { eliminationStartWeek?: number | null; chopListOrder?: ChopListOrder | null } | null
}

export function boardFromNativeSummary(summary: NativeBoardSummary, opts: { order?: ChopListOrder } = {}): SurvivalBoard {
  const me = summary.myRosterId ?? null
  // Before anyone scores there is no chop line on purpose (./chopWatch.ts), but the field is known: list it,
  // every team level, rather than "the chop line appears once the season has started" after a draft.
  const tiers: DangerTierRow[] = summary.dangerTiers?.length
    ? summary.dangerTiers
    : (summary.field ?? []).map((t) => ({ rosterId: t.rosterId, displayName: t.displayName, tier: 'safe', pointsFromChopZone: 0 }))
  const line = buildChopLine(tiers, me, summary.home?.scores ?? null)
  return finish({
    source: 'native',
    week: summary.chopWatch?.week ?? summary.weekOrPeriod ?? null,
    chopCount: summary.chopWatch?.chopCount ?? 1,
    rows: line.rows.map((r) => ({ rosterId: r.rosterId, name: r.name, points: r.points, tier: r.tier, isMe: r.isMe, immune: r.immune })),
    myRosterId: me,
    graveyard: (summary.home?.chopped ?? []).map((c) => ({ rosterId: c.rosterId, name: c.name?.trim() || 'A team', week: c.week ?? null, isMe: !!me && c.rosterId === me })),
    chopLabel: summary.home?.chopLabel ?? null,
    outlook: summary.outlook ?? null,
    order: opts.order ?? summary.config?.chopListOrder ?? undefined,
    notCounting:
      summary.calendarWeek != null && summary.config?.eliminationStartWeek != null && summary.calendarWeek < summary.config.eliminationStartWeek
        ? { calendarWeek: summary.calendarWeek, startWeek: summary.config.eliminationStartWeek }
        : null,
  })
}

/** The weeks the history can replay, oldest first: every week the chop has already scored. */
export function historyWeeks(history: SurvivalHistory | null | undefined): number[] {
  return [...new Set((history?.weeks ?? []).map((w) => w.week))].sort((a, b) => a - b)
}

/**
 * A week that has already been chopped, rebuilt from the season's history (./survivalHistory.ts): every team
 * that scored that week, the teams it chopped, and the graveyard as it stood when that chop was done. Null
 * when the history holds no score for the week. A survivor within `dangerMargin` of the line is shown in danger.
 */
export function boardFromHistoryWeek(
  history: SurvivalHistory | null | undefined,
  week: number,
  opts: { myRosterId?: string | null; order?: ChopListOrder; dangerMargin?: number | null; source?: SurvivalBoard['source'] } = {},
): SurvivalBoard | null {
  if (!history) return null
  const me = opts.myRosterId ?? null
  const margin = opts.dangerMargin ?? 0
  const rows: SharedRow[] = []
  for (const team of history.teams) {
    const step = team.path.find((p) => p.week === week)
    if (!step) continue
    const tier: BoardTier = step.chopped ? 'chop_zone' : step.margin != null && step.margin <= margin ? 'danger' : 'safe'
    rows.push({ rosterId: team.rosterId, name: team.name, points: step.points, tier, isMe: !!me && team.rosterId === me, immune: false })
  }
  if (rows.length === 0) return null
  return finish({
    source: opts.source ?? 'native',
    week,
    chopCount: rows.filter((r) => r.tier === 'chop_zone').length,
    rows,
    myRosterId: me,
    graveyard: history.teams
      .filter((t) => t.choppedWeek != null && t.choppedWeek <= week)
      .map((t) => ({ rosterId: t.rosterId, name: t.name, week: t.choppedWeek, isMe: !!me && t.rosterId === me })),
    chopLabel: null,
    order: opts.order,
    final: true,
  })
}

export function boardFromImportedView(
  view: ImportedGuillyViewData,
  myRosterId: string | null | undefined,
  /** Per provider roster id (./survivalOutlookLoad.ts `loadImportedSurvivalOutlook`); null = none. */
  outlook?: Record<string, TeamOutlook> | null,
  opts: { order?: ChopListOrder } = {},
): SurvivalBoard {
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
    outlook: outlook ?? null,
    order: opts.order,
  })
}
