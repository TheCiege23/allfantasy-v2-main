/**
 * Notifications in plain words (2026-11-14).
 *
 * The owner's ask, for every page: users should know what the page is for and what to do. The
 * notifications list was 45 rows of sports news out of 60, none of which could be opened; lineup
 * alerts squeezed four leagues into one sentence cut off with "…" under one league's tag; and each
 * row's menu said "Accepted by provider". These rules fix that and stay pure, so they are testable
 * and the screen stays a renderer.
 *
 * Imported by both the server loader and the client screen, so nothing here may touch the server.
 */
import type { NotificationRow } from './notificationsCenter'

/** Types written by lib/news/breakingNewsAlerts.ts: news for everyone who follows a sport. */
const SPORTS_NEWS_TYPES = new Set(['sports_news', 'breaking_news'])

export function isSportsNewsType(type: string | null | undefined): boolean {
  return SPORTS_NEWS_TYPES.has(String(type ?? ''))
}

function metaRecord(meta: unknown): Record<string, unknown> | null {
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : null
}

/** The outlet a story came from ("ESPN"), or null when the alert did not say. */
export function storySource(meta: unknown): string | null {
  const source = metaRecord(meta)?.source
  return typeof source === 'string' && source.trim() ? source.trim().slice(0, 40) : null
}

/**
 * The story a news alert points at. https only: this becomes a link that opens in a new tab, and a
 * stored URL is data, so anything else (http, javascript:, a relative path) gets no link at all.
 */
export function newsStoryLink(meta: unknown): { href: string; label: string } | null {
  const m = metaRecord(meta)
  if (!m) return null
  const raw = typeof m.sourceUrl === 'string' ? m.sourceUrl : typeof m.actionHref === 'string' ? m.actionHref : null
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const source = storySource(meta) ?? url.hostname.replace(/^www\./, '')
  return { href: url.toString(), label: `Read on ${source}` }
}

/** One row on screen: a notification, or one sport's ordinary news for one day folded together. */
export type FeedItem =
  | { type: 'row'; row: NotificationRow }
  | { type: 'news'; key: string; sport: string; rows: NotificationRow[]; createdAt: string; read: boolean }

function sportOf(row: NotificationRow): string {
  const sport = metaRecord(row.meta)?.sport
  if (typeof sport === 'string' && sport.trim()) return sport.trim()
  return row.title.replace(/\s+news$/i, '').trim() || row.title
}

/**
 * Folds each sport's ordinary news for one day into one item, placed where its newest story was.
 * Only `sports_news`: a `breaking_news` alert (a trade, a big injury) keeps its own row, and a
 * sport with a single story that day stays a plain row rather than a group of one.
 *
 * The day is the UTC date, the same day the screen's date headings use.
 */
export function groupNewsByDay(rows: NotificationRow[]): FeedItem[] {
  const groups = new Map<string, Extract<FeedItem, { type: 'news' }>>()
  const items: FeedItem[] = []
  for (const row of rows) {
    if (row.kind !== 'news' || row.type !== 'sports_news') {
      items.push({ type: 'row', row })
      continue
    }
    const sport = sportOf(row)
    const key = `${row.createdAt.slice(0, 10)}|${sport.toLowerCase()}`
    const group = groups.get(key)
    if (group) {
      group.rows.push(row)
      group.read = group.read && row.read
      continue
    }
    const created: Extract<FeedItem, { type: 'news' }> = {
      type: 'news', key, sport, rows: [row], createdAt: row.createdAt, read: row.read,
    }
    groups.set(key, created)
    items.push(created)
  }
  return items.map((item) => (item.type === 'news' && item.rows.length === 1 ? { type: 'row', row: item.rows[0] } : item))
}

/**
 * A detail written one line per league (lineupImpactCopy joins its options with "\n") reads as one
 * line each, not one run-on sentence.
 */
export function detailLines(detail: string): string[] {
  return detail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/**
 * A row's league tag names ONE league. An alert whose detail has a line per league covers several
 * (its stored leagueId is only the first), so the tag would claim one league for a four-league alert.
 */
export function showLeagueTag(row: Pick<NotificationRow, 'leagueName' | 'detail'>): boolean {
  if (!row.leagueName) return false
  const lines = detailLines(row.detail)
  if (lines.length > 1) return false
  // "Top Shelf Cartel: no bench player can come in" already names the league; the tag would say it twice.
  return !(lines[0] ?? '').toLowerCase().startsWith(`${row.leagueName.toLowerCase()}:`)
}

/** The sport a news row is about ("NCAAB"), from the alert's meta, else its "NCAAB news" title. */
export function newsSport(row: Pick<NotificationRow, 'meta' | 'title'>): string {
  return sportOf(row as NotificationRow)
}

/**
 * A headline without its "— via ESPN" tail, for a list whose summary already names the outlet once.
 * Only the tail naming THIS row's outlet is removed, so a headline that merely contains "via" stays whole.
 */
export function headlineOf(row: Pick<NotificationRow, 'meta' | 'detail'>): string {
  const source = storySource(row.meta)
  if (!source) return row.detail
  const tail = ` — via ${source}`
  return row.detail.endsWith(tail) ? row.detail.slice(0, -tail.length) : row.detail
}

/** The one outlet every story in a group came from, or null when they differ or are unnamed. */
export function commonSource(rows: Array<Pick<NotificationRow, 'meta'>>): string | null {
  const sources = new Set(rows.map((r) => storySource(r.meta)))
  const [only] = [...sources]
  return sources.size === 1 && only ? only : null
}

export type DeliveryChannel = 'phone' | 'phoneTablet' | 'desktop' | 'email' | 'text'
export type DeliveryResult = 'sent' | 'someDevices' | 'retrying' | 'notSent' | 'quietHours' | 'noDevice' | 'failed' | 'unknown'

/** Where a notification went, in words a person uses. The inbox line is always first and always true. */
export function deliveryLines(meta: unknown): Array<{ channel: DeliveryChannel; result: DeliveryResult }> {
  const delivery = metaRecord(meta)?.delivery as Record<string, { status?: string; reason?: string }> | undefined
  if (!delivery || typeof delivery !== 'object') return []
  const channels: Array<[string, DeliveryChannel]> =
    delivery.mobile || delivery.desktop
      ? [['mobile', 'phoneTablet'], ['desktop', 'desktop'], ['email', 'email'], ['sms', 'text']]
      : [['push', 'phone'], ['email', 'email'], ['sms', 'text']]
  const out: Array<{ channel: DeliveryChannel; result: DeliveryResult }> = []
  for (const [key, channel] of channels) {
    const entry = delivery[key]
    if (!entry?.status) continue
    const result: DeliveryResult =
      entry.reason === 'quiet_hours' ? 'quietHours'
      : entry.reason === 'no_subscriptions' ? 'noDevice'
      : entry.status === 'accepted' ? 'sent'
      : entry.status === 'partial' ? 'someDevices'
      : entry.status === 'delayed' ? 'retrying'
      : entry.status === 'suppressed' ? 'notSent'
      : entry.status === 'failed' ? 'failed'
      : 'unknown'
    out.push({ channel, result })
  }
  return out
}
