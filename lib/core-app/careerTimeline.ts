import { rankBestSeasons, recordLine, type CareerRow } from './careerModel'
import { TIER_LABEL, type CareerAward } from './careerAwards'
import type { CareerRival } from './careerRecordBook'
import type { CareerTradeEvent } from './careerTrades'

/**
 * The career timeline (brief item 2): drafts, trades, awards, championships,
 * rivals and the big moments, in order.
 *
 * ⚠ GROUPED BY FANTASY SEASON, NOT BY CALENDAR DATE. Most of what a career holds
 * — a title, a berth, joining a league — is recorded against a season and has no
 * timestamp at all. Inventing a date for those so they can sit in one dated list
 * would place a December title before an August trade by accident. So a season
 * is the unit, headline events lead it, and only trades (which do carry a date)
 * are ordered by date inside it.
 *
 * ⚠ PURE. Every input is already loaded; the page decides which loaders run.
 */

export const TIMELINE_KINDS = ['title', 'milestone', 'award', 'draft', 'trade', 'rival', 'league'] as const
export type TimelineKind = (typeof TIMELINE_KINDS)[number]

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  title: 'Championships',
  milestone: 'Milestones',
  award: 'Awards',
  draft: 'Drafts',
  trade: 'Trades',
  rival: 'Rivals',
  league: 'Leagues',
}

export type TimelineEvent = {
  key: string
  kind: TimelineKind
  season: number
  /** ISO — only trades carry one. */
  date: string | null
  title: string
  detail: string | null
  tone: 'warn' | 'good' | 'accent' | 'bad' | 'info'
  /** A folded list under the event — league names, draft picks, trades. */
  items?: string[]
  /** How many more `items` exist than are listed. */
  more?: number
}

export type TimelineSeason = {
  season: number
  record: string | null
  titles: number
  events: TimelineEvent[]
}

export type CareerTimeline = {
  seasons: TimelineSeason[]
  counts: Record<TimelineKind, number>
  kind: TimelineKind | null
  notes: string[]
}

export function parseTimelineKind(raw: string | null | undefined): TimelineKind | null {
  return (TIMELINE_KINDS as readonly string[]).includes(raw ?? '') ? (raw as TimelineKind) : null
}

/** Items listed per folded event before "and N more". */
const LIST_CAP = 8
/** Trades listed per season on the all-kinds view. */
const TRADES_PER_SEASON = 4
const WIN_MILESTONES = [100, 250, 500, 1000, 2000, 3000]

const ORDER: Record<TimelineKind, number> = { title: 0, award: 1, milestone: 2, rival: 3, draft: 4, trade: 5, league: 6 }

function capped(items: string[], cap = LIST_CAP): { items: string[]; more: number } {
  return { items: items.slice(0, cap), more: Math.max(0, items.length - cap) }
}

export function buildCareerTimeline(input: {
  rows: CareerRow[]
  awards: CareerAward[]
  trades: CareerTradeEvent[]
  tradesOmitted: number
  drafts: Array<{
    season: number
    leagueName: string
    firstPick: { round: number; pickNumber: number; player: string } | null
    picks: number
    grade: string | null
  }>
  rivals: CareerRival[]
  kind: TimelineKind | null
}): CareerTimeline {
  const events: TimelineEvent[] = []
  const counted = input.rows.filter((r) => r.counted)

  /* titles */
  for (const r of counted.filter((x) => x.isChampion)) {
    events.push({
      key: `title:${r.key}`,
      kind: 'title',
      season: r.season,
      date: null,
      title: `Champion — ${r.leagueName}`,
      detail: [recordLine(r.wins, r.losses, r.ties), r.settingsLabel].filter(Boolean).join(' · ') || null,
      tone: 'warn',
    })
  }

  /* milestones */
  const seasons = [...new Set(counted.map((r) => r.season))].sort((a, b) => a - b)
  if (seasons.length > 0) {
    const first = seasons[0]
    const firstRows = counted.filter((r) => r.season === first)
    events.push({
      key: `ms:first:${first}`,
      kind: 'milestone',
      season: first,
      date: null,
      title: 'Career on record begins',
      detail: `${firstRows.length} ${firstRows.length === 1 ? 'league' : 'leagues'} finished in ${first}`,
      tone: 'accent',
    })
    const firstTitle = [...counted].filter((r) => r.isChampion).sort((a, b) => a.season - b.season)[0]
    if (firstTitle) {
      events.push({
        key: `ms:firsttitle`,
        kind: 'milestone',
        season: firstTitle.season,
        date: null,
        title: 'First championship',
        detail: firstTitle.leagueName,
        tone: 'warn',
      })
    }
    let wins = 0
    let next = 0
    for (const s of seasons) {
      wins += counted.filter((r) => r.season === s).reduce((n, r) => n + r.wins, 0)
      while (next < WIN_MILESTONES.length && wins >= WIN_MILESTONES[next]) {
        events.push({
          key: `ms:wins:${WIN_MILESTONES[next]}`,
          kind: 'milestone',
          season: s,
          date: null,
          title: `Win number ${WIN_MILESTONES[next].toLocaleString('en-US')}`,
          detail: `${wins.toLocaleString('en-US')} career wins by the end of ${s}`,
          tone: 'good',
        })
        next += 1
      }
    }
    const best = rankBestSeasons(counted, 1)[0]
    if (best) {
      events.push({
        key: `ms:best`,
        kind: 'milestone',
        season: best.season,
        date: null,
        title: 'Best league-season on record',
        detail: `${best.leagueName} · ${best.record}${best.champion ? ' · champion' : best.madePlayoffs ? ' · playoffs' : ''}`,
        tone: 'good',
      })
    }
  }

  /* awards */
  for (const a of input.awards) {
    events.push({
      key: `award:${a.key}`,
      kind: 'award',
      season: a.earnedSeason,
      date: null,
      title: `${a.name} · ${TIER_LABEL[a.tier]}`,
      detail: a.evidence,
      tone: 'warn',
    })
  }

  /* leagues joined and left */
  const byLeague = new Map<string, { name: string; first: number; last: number }>()
  for (const r of input.rows.filter((x) => x.inRollup || x.counted)) {
    const held = byLeague.get(r.leagueKey)
    if (held) {
      held.first = Math.min(held.first, r.season)
      held.last = Math.max(held.last, r.season)
    } else byLeague.set(r.leagueKey, { name: r.leagueName, first: r.season, last: r.season })
  }
  const newest = Math.max(0, ...input.rows.map((r) => r.season))
  const joined = new Map<number, string[]>()
  const left = new Map<number, string[]>()
  for (const l of byLeague.values()) {
    joined.set(l.first, [...(joined.get(l.first) ?? []), l.name])
    if (l.last < newest) left.set(l.last, [...(left.get(l.last) ?? []), l.name])
  }
  for (const [season, names] of joined) {
    const list = capped(names.sort())
    events.push({
      key: `league:joined:${season}`,
      kind: 'league',
      season,
      date: null,
      title: `Joined ${names.length} ${names.length === 1 ? 'league' : 'leagues'}`,
      detail: 'First season on record for each',
      tone: 'info',
      ...list,
    })
  }
  for (const [season, names] of left) {
    const list = capped(names.sort())
    events.push({
      key: `league:left:${season}`,
      kind: 'league',
      season,
      date: null,
      title: `Last season in ${names.length} ${names.length === 1 ? 'league' : 'leagues'}`,
      detail: `Not on record after ${season}`,
      tone: 'info',
      ...list,
    })
  }

  /* drafts */
  const draftsBySeason = new Map<number, typeof input.drafts>()
  for (const d of input.drafts) draftsBySeason.set(d.season, [...(draftsBySeason.get(d.season) ?? []), d])
  for (const [season, list] of draftsBySeason) {
    const sorted = [...list].sort((a, b) => (a.firstPick?.pickNumber ?? 999) - (b.firstPick?.pickNumber ?? 999))
    const graded = list.filter((d) => d.grade)
    const lines = sorted.map(
      (d) =>
        `${d.leagueName} — ${d.firstPick ? `opened with ${d.firstPick.player} (round ${d.firstPick.round}, pick ${d.firstPick.pickNumber})` : `${d.picks} picks`}${d.grade ? ` · grade ${d.grade}` : ''}`,
    )
    const shown = input.kind === 'draft' ? { items: lines, more: 0 } : capped(lines)
    events.push({
      key: `draft:${season}`,
      kind: 'draft',
      season,
      date: null,
      title: `Drafted in ${list.length} ${list.length === 1 ? 'league' : 'leagues'}`,
      detail: `${list.reduce((n, d) => n + d.picks, 0)} picks${graded.length ? ` · ${graded.length} graded` : ''}`,
      tone: 'accent',
      ...shown,
    })
  }

  /* trades */
  const tradesBySeason = new Map<number, CareerTradeEvent[]>()
  for (const t of input.trades) tradesBySeason.set(t.season, [...(tradesBySeason.get(t.season) ?? []), t])
  for (const [season, list] of tradesBySeason) {
    const ranked =
      input.kind === 'trade'
        ? [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        : [...list]
            .sort((a, b) => Math.abs(b.net ?? 0) - Math.abs(a.net ?? 0) || b.assets - a.assets)
            .slice(0, TRADES_PER_SEASON)
    for (const t of ranked) {
      const got = t.got.length ? t.got.join(', ') : 'nothing listed'
      const gave = t.gave.length ? t.gave.join(', ') : 'nothing listed'
      events.push({
        key: `trade:${t.id}`,
        kind: 'trade',
        season,
        date: t.date,
        title: `Traded ${gave} for ${got}`,
        detail: [
          t.leagueName,
          t.partner ? `with ${t.partner}` : null,
          t.net != null ? `${t.net >= 0 ? '+' : ''}${Math.round(t.net)} pts while held` : null,
          t.grade && t.net != null ? `now ${t.grade}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
        tone: t.net == null ? 'info' : t.net >= 0 ? 'good' : 'bad',
      })
    }
    if (input.kind !== 'trade' && list.length > ranked.length) {
      events.push({
        key: `trade:more:${season}`,
        kind: 'trade',
        season,
        date: null,
        title: `${list.length - ranked.length} more ${list.length - ranked.length === 1 ? 'trade' : 'trades'} in ${season}`,
        detail: 'Filter the timeline to trades to see every one.',
        tone: 'info',
      })
    }
  }

  /* rivals */
  for (const r of input.rivals.slice(0, 5)) {
    events.push({
      key: `rival:${r.key}`,
      kind: 'rival',
      season: r.lastSeason,
      date: null,
      title: `Rivalry: ${r.name}`,
      detail: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''} in ${r.meetings} meetings · ${r.leagues.slice(0, 2).join(', ')}${r.leagues.length > 2 ? ` +${r.leagues.length - 2}` : ''} · ${r.seasons[0]}${r.seasons.length > 1 ? `–${r.seasons[r.seasons.length - 1]}` : ''}`,
      tone: r.wins >= r.losses ? 'good' : 'bad',
    })
  }

  const counts = Object.fromEntries(TIMELINE_KINDS.map((k) => [k, 0])) as Record<TimelineKind, number>
  for (const e of events) if (!e.key.startsWith('trade:more:')) counts[e.kind] += 1
  counts.trade = input.trades.length

  const visible = input.kind ? events.filter((e) => e.kind === input.kind) : events
  const bySeason = new Map<number, TimelineEvent[]>()
  for (const e of visible) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e])

  const out: TimelineSeason[] = [...bySeason.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([season, list]) => {
      const rows = counted.filter((r) => r.season === season)
      const w = rows.reduce((n, r) => n + r.wins, 0)
      const l = rows.reduce((n, r) => n + r.losses, 0)
      const t = rows.reduce((n, r) => n + r.ties, 0)
      return {
        season,
        record: recordLine(w, l, t),
        titles: rows.filter((r) => r.isChampion).length,
        events: [...list].sort(
          (a, b) => ORDER[a.kind] - ORDER[b.kind] || (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title),
        ),
      }
    })

  const notes: string[] = []
  if (input.tradesOmitted > 0) {
    notes.push(`${input.tradesOmitted} older trades are on file but not listed — the timeline stops at 400.`)
  }
  if (input.drafts.length === 0) {
    notes.push('No draft picks of yours are on file. Drafts appear once a league’s history has been backfilled.')
  }
  if (input.rivals.length === 0) {
    notes.push('No head-to-head games are on file for your claimed teams, so no rivalries can be named yet.')
  }

  return { seasons: out, counts, kind: input.kind, notes }
}
