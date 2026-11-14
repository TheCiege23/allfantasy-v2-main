'use client'

import Link from 'next/link'
import { ArrowLeftRight, Bell, ClipboardList, Clock, Megaphone, MessageSquare, Newspaper, Users } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { useClientSyncAccount } from '@/components/providers/ClientSyncAccountProvider'
import { groupNotificationRows } from '@/lib/core-app/notificationGroups'
import type {
  NotificationFilter,
  NotificationRow,
  NotificationsCenterData,
} from '@/lib/core-app/notificationsCenter'
import { EnableWebPushCard } from '@/components/notifications/EnableWebPushCard'
import { IosAppPushCard } from '@/components/notifications/IosAppPushCard'
import { FinalScoreLogos } from '@/components/notifications/FinalScoreLogos'
import { InstallButton } from '@/components/pwa/PWAActions'
import { NotificationRowMute } from '@/components/core-app/screens/NotificationRowMute'
import '@/components/core-app/af-notifications.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { messagesFor } from '@/lib/i18n/messages'
import { notificationsCenterMessages } from '@/lib/core-app/messages/notificationsCenter'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { survivorNotificationIcon } from '@/lib/core-app/survivorNotificationIcon'
import { SurvivorNotificationGlyph } from '@/components/core-app/survivor/SurvivorNotificationGlyph'
import {
  commonSource, deliveryLines, detailLines, groupNewsByDay, headlineOf, newsSport, showLeagueTag, storySource,
} from '@/lib/core-app/notificationsGuide'

/**
 * 22c — the in-app notifications centre.
 *
 * ⚠ FILTER COUNTS ARE LIVE, NOT LITERALS. They come off the loader's `counts`,
 * which is derived from the rows in view. The handoff's own numbers (Trades 6,
 * Waivers 6 …) are that account's, and hardcoding them is how a filter ends up
 * promising six trades and showing none.
 *
 * ⚠ "ACT TODAY" IS THE SAME URGENCY AS EVERYWHERE ELSE. It is built upstream
 * from `deriveOutstandingIssues` — the engine behind the home queue and the
 * Tools hub — so a lineup that is urgent here is urgent there too.
 *
 * ⚠ ACTION LABELS ARE VERBS. Fix, Queue, Review, Reply — decided once, in
 * `verbFor` in the loader. If a generic "Open" ever appears on this screen, the
 * fix is in that function, not here.
 *
 * The lock-screen preview is rendered by `LockScreenPreview` in the dev handoff
 * preview rather than in the product — it is a mock of the phone, not a surface
 * a signed-in user needs. The selection logic behind it, however, is real and
 * shared: `selectPushNotifications`.
 */

export type NotificationsCenterProps = {
  data: NotificationsCenterData
}

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'trades', label: 'Trades' },
  { id: 'waivers', label: 'Waivers' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'mentions', label: 'Messages' },
  // 38a gives commissioner announcements their own chip. Before this they
  // classified as 'all' and sat unfindable among everything else — or worse, as
  // 'trades', because "commissioner confirmed the trade deadline" matches on
  // the word trade.
  { id: 'commissioner', label: 'Commissioner' },
  { id: 'drafts', label: 'Drafts' },
  // Sports news for everyone who follows a sport (2026-11-14). Its label comes from the page's
  // catalog rather than coreUiCopy, so Spanish reads "Noticias".
  { id: 'news', label: 'News' },
]

/**
 * The chips this account can actually fill.
 *
 * ⚠ MENTIONS IS DROPPED WHEN NOTHING COULD EVER PRODUCE ONE. On a league with no
 * Discord bridge there is no mention source at all — platform chat is never
 * read, synced or stored, which the Sync tab states as a product promise one tab
 * away. A chip that is structurally always zero is worse than no chip: it reads
 * as "nobody mentioned you" rather than "we do not look".
 */
function visibleFilters(mentionsAvailable: boolean): Array<{ id: NotificationFilter; label: string }> {
  return mentionsAvailable ? FILTERS : FILTERS.filter((f) => f.id !== 'mentions')
}

function timeAgo(iso: string, language = 'en'): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = messagesFor(notificationsCenterMessages, language)
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return m.justNow
  if (mins < 60) return m.minsAgo(mins)
  const hours = Math.round(mins / 60)
  if (hours < 24) return m.hoursAgo(hours)
  return m.daysAgo(Math.round(hours / 24))
}

/** Where the notification went, in plain words ("Phone · sent", "Email · not sent"). */
function DeliveryDetails({ meta }: { meta: unknown }) {
  const m = useMessages(notificationsCenterMessages)
  return <ul className="af-nt-delivery" aria-label={m.deliveryLabel} data-testid="notification-delivery">
    <li>{m.inbox}</li>
    {deliveryLines(meta).map(({ channel, result }) => <li key={channel}>{m[channel]} · {m[result]}</li>)}
  </ul>
}

const rowIcons = {
  all: Bell, trades: ArrowLeftRight, waivers: Users, lineups: ClipboardList,
  mentions: MessageSquare, commissioner: Megaphone, drafts: Clock, news: Newspaper,
}

/**
 * One sport's ordinary news for one day, folded into one row: "NCAAB news · 28 stories". Opening it
 * lists the headlines, each a link to the story. On 2026-11-14 one account's newest 60 notifications
 * held 45 news rows, 30 of them college basketball previews, and none could be opened.
 */
function NewsGroupRow({ sport, rows, read, onRead }: { sport: string; rows: NotificationRow[]; read: boolean; onRead?: (id: string) => void }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(notificationsCenterMessages)
  /* The outlet and the time, each said once: in the summary, and on a headline only when it changes. */
  const source = commonSource(rows)
  const groupTime = timeAgo(rows[0].createdAt, language)
  let shownTime = groupTime
  return (
    <li className="af-nt-row af-nt-newsgroup" data-read={read} data-severity="info" data-urgent={false} data-testid="notification-news-group">
      <details className="af-nt-newsgroup-fold">
        <summary className="af-nt-row-link">
          <span className="af-nt-dot" aria-hidden />
          <Newspaper className="af-nt-row-icon" aria-hidden />
          <span className="af-nt-body">
            <span className="af-nt-toprow"><b className="af-nt-title">{m.sportNews(sport)}</b></span>
            <span className="af-nt-detail">{source ? m.storiesFrom(rows.length, source) : m.stories(rows.length)}</span>
            <span className="af-nt-time af-num">{groupTime}</span>
          </span>
        </summary>
        <ul className="af-nt-headlines">
          {rows.map((row) => {
            const time = timeAgo(row.createdAt, language)
            const showTime = time !== shownTime
            shownTime = time
            const headline = source ? headlineOf(row) : row.detail
            return (
              <li key={row.id} data-read={row.read}>
                {row.action?.external
                  ? <a href={row.action.href} target="_blank" rel="noopener noreferrer" onClick={() => onRead?.(row.id)}>{headline} <span aria-hidden>↗</span></a>
                  : <span>{headline}</span>}
                {showTime ? <span className="af-nt-time af-num">{time}</span> : null}
              </li>
            )
          })}
        </ul>
      </details>
    </li>
  )
}

function Row({
  row,
  urgent,
  onRead,
  groupedRows = [],
}: {
  row: NotificationRow
  urgent?: boolean
  onRead?: (id: string) => void
  groupedRows?: NotificationRow[]
}) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const m = useMessages(notificationsCenterMessages)
  /* A Survivor notice wears its island icon (by kind) and the torch accent. Display only. */
  const svIcon = survivorNotificationIcon(row.survivorType)
  const Icon = rowIcons[row.kind] ?? Bell
  const lines = detailLines(row.detail)
  const source = row.kind === 'news' ? storySource(row.meta) : null
  const actionLabel = row.action ? (source && row.action.external ? m.readOn(source) : copy(row.action.label)) : ''
  const content = (
    <>
      <span className="af-nt-dot" aria-hidden />
      {svIcon ? (
        <span className="af-nt-sv-icon" aria-hidden="true" data-testid="survivor-notification-icon">
          <SurvivorNotificationGlyph icon={svIcon} />
        </span>
      ) : <Icon className="af-nt-row-icon" aria-hidden />}
      <span className="af-nt-body">
        <span className="af-nt-toprow">
          {/* An ordinary news row's stored title is English ("NHL news"); say it from the catalog. */}
          <b className="af-nt-title">{row.kind === 'news' && row.type === 'sports_news' ? m.sportNews(newsSport(row)) : copy(row.title)}</b>
          {/* One league's tag on a one-league notice; an alert with a line per league names them below. */}
          {showLeagueTag(row) ? (
            <span className="af-nt-league af-platform" data-platform={row.platform ?? undefined}>
              {row.leagueName}
            </span>
          ) : null}
        </span>
        <FinalScoreLogos type={row.type ?? ''} meta={row.meta} />
        {/* The specific reason. Never "you have an update". One line per league when it covers several. */}
        {lines.length > 1 ? (
          <span className="af-nt-lines" data-testid="notification-lines">
            {lines.map((line, i) => <span key={i} className="af-nt-line">{copy(line)}</span>)}
          </span>
        ) : (
          <span className="af-nt-detail" title={copy(row.detail)}>{copy(row.detail)}</span>
        )}
        {!urgent ? <span className="af-nt-time af-num">{timeAgo(row.createdAt, language)}{row.relatedIds && row.relatedIds.length > 1 ? m.matchingNotices(row.relatedIds.length) : ''}</span> : null}
      </span>

    </>
  )
  return (
    <li
      className="af-nt-row"
      data-severity={row.severity}
      data-read={row.read}
      data-urgent={!!urgent}
      data-survivor={svIcon ?? undefined}
    >
      {row.action?.external ? (
        <a className="af-nt-row-link" aria-label={`${actionLabel} · ${copy(row.title)}`} href={row.action.href} target="_blank" rel="noopener noreferrer" onClick={() => onRead?.(row.id)}>{content}</a>
      ) : row.action ? (
        <Link className="af-nt-row-link" aria-label={`${actionLabel} · ${copy(row.title)}`} href={row.action.href} onClick={() => onRead?.(row.id)}>{content}</Link>
      ) : <span className="af-nt-row-link">{content}</span>}
      {!urgent ? <details className="af-nt-row-menu">
        <summary aria-label={copy('Notification details')}>⋯</summary>
        <DeliveryDetails meta={row.meta} />
        {groupedRows.length > 1 ? <ul>{groupedRows.map((item) => <li key={item.id}>{item.action && !item.action.external
          ? <Link href={item.action.href} onClick={() => onRead?.(item.id)}>{copy(item.detail || item.title)}</Link>
          : copy(item.title)}</li>)}</ul> : null}
      {/*
        One tap to the provider screen that acts on this (2026-09-14). The loader only
        sets `handoff` for a VERIFIED destination — never a homepage fallback, never
        MFL / Fantrax / Fleaflicker — so a row without one keeps just its in-app action.
        Stored rows only: an "act today" row already carries its platform link as the action.
      */}
      {!urgent && row.handoff ? (
        <a
          className="af-nt-handoff"
          href={row.handoff.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`${copy(row.handoff.label)} · ${copy(row.handoff.screen)}`}
          onClick={() => onRead?.(row.id)}
        >
          {copy(row.handoff.label)} <span aria-hidden>↗</span>
        </a>
      ) : null}

      {/*
        Mute from where the noise is seen (2026-09-14). Stored rows only: an "act today"
        row is a deadline derived from league state, not a notification anyone sent, so
        muting it would silence nothing.
      */}
      {!urgent && row.leagueId ? (
        <NotificationRowMute leagueId={row.leagueId} leagueName={row.leagueName} category={row.category ?? null} />
      ) : null}
      </details> : null}
    </li>
  )
}

function NotificationDayRow({ date, ...props }: ComponentProps<typeof Row> & { date: string | null }) {
  return <>{date ? <li className="af-nt-day"><h3>{date}</h3></li> : null}<Row {...props} /></>
}

export function NotificationsCenter({ data }: NotificationsCenterProps) {
  const accountId = useClientSyncAccount()
  const m = useMessages(notificationsCenterMessages)
  if (data.viewerId && data.viewerId !== accountId) return <p role="status">{m.loading}</p>
  return <ScopedNotificationsCenter key={`${accountId ?? ''}:${data.leagueId ?? ''}`} data={data} />
}

function ScopedNotificationsCenter({ data }: NotificationsCenterProps) {
  const { language } = useOptionalLanguage()
  const copy = (english: string) => coreUiCopy(english, language)
  const m = useMessages(notificationsCenterMessages)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [league, setLeague] = useState('')
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [marking, setMarking] = useState(false)
  const [markedAll, setMarkedAll] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const seq = useRef(0)
  const busy = useRef(false)
  useEffect(() => {
    seq.current += 1
    busy.current = false
    setReadIds(new Set())
    setMarkedAll(false)
    setMarking(false)
    setReadError(null)
    return () => { seq.current += 1 }
  }, [data.rest, data.unread])

  const match = useCallback(
    (r: NotificationRow) => (!league || r.leagueId === league) && (filter === 'all' || r.kind === filter),
    [filter, league],
  )

  const leagues = useMemo(() => [...new Map([...data.actToday, ...data.rest].flatMap((row) =>
    row.leagueId && row.leagueName ? [[row.leagueId, row.leagueName] as const] : []))].sort((a, b) => a[1].localeCompare(b[1])), [data.actToday, data.rest])
  const actToday = useMemo(() => data.actToday.filter(match), [data.actToday, match])
  const rest = useMemo(
    () =>
      groupNotificationRows(data.rest
        .filter(match)
        .map((r) => (markedAll || readIds.has(r.id) ? { ...r, read: true } : r)))
        .filter((r) => !unreadOnly || !r.read),
    [data.rest, match, markedAll, readIds, unreadOnly],
  )
  /* One row per sport's news per day; everything else stays a row of its own. */
  const feed = useMemo(() => groupNewsByDay(rest), [rest])
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString(language, { dateStyle: 'medium', timeZone: 'UTC' })
  const filterLabel = (id: NotificationFilter) =>
    id === 'news' ? m.news : copy(FILTERS.find((f) => f.id === id)?.label ?? 'All')

  /*
   * Marking read hits the existing PATCH on /api/user/notifications — no new
   * route. The repo sits at Vercel's hard 2048-route ceiling and a read-receipt
   * is not worth one; that endpoint already accepts `{ ids: [...] }` or
   * `{ ids: "all" }`.
   *
   * Derived "act today" rows carry an `issue:` id and have no database row, so
   * they are filtered out of the request rather than sent and silently ignored.
   */
  const markRead = useCallback(async (ids: string[] | 'all') => {
    if (busy.current) return
    const payload =
      ids === 'all' ? 'all' : [...new Set(ids.flatMap((id) =>
        groupNotificationRows(data.rest).find((r) => r.id === id)?.relatedIds ?? [id],
      ))].filter((id) => !id.startsWith('issue:'))
    if (payload !== 'all' && payload.length === 0) return
    busy.current = true
    const mine = ++seq.current
    setMarking(true)
    setReadError(null)
    const response = await fetch('/api/user/notifications', {
      method: 'PATCH',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: payload, ...(data.leagueId ? { leagueId: data.leagueId } : {}) }),
    }).catch(() => null)
    const result = await response?.json?.().catch(() => null)
    if (mine !== seq.current) return
    busy.current = false
    if (!response?.ok || result?.success !== true) {
      setReadError('Could not mark notifications read. Please try again.')
      setMarking(false)
      return
    }
    if (payload === 'all') setMarkedAll(true)
    setReadIds((prev) => {
      const next = new Set(prev)
      if (payload === 'all') for (const r of data.rest) next.add(r.id)
      else for (const id of payload) next.add(id)
      return next
    })
    setMarking(false)
  }, [data.rest, data.leagueId])

  /*
   * 🛑 THE TRUE COUNT, FROM THE LOADER - DO NOT RECOMPUTE IT FROM `rest`.
   * `rest` holds only the newest 60 stored rows, so counting unread inside it
   * reports "unread among the ones we loaded" while the sentence below reads as
   * a claim about the whole account. That is how this screen came to say
   * "Nothing is waiting on you" beside a nav badge reading 55.
   *
   * ⚠ AND IT IS DELIBERATELY NOT FILTER-SENSITIVE. The chips filter the LIST;
   * they do not change how much is waiting on you. The old count moved with the
   * active chip, so selecting an empty one also claimed nothing was waiting.
   *
   * Marking read is reconciled locally so the number moves when the user acts:
   * 'all' sends `ids: 'all'`, which clears every row for this user server-side,
   * so it goes to zero rather than dropping by the 60 that happen to be listed.
   */
  const locallyRead = data.rest.filter((r) => !r.read && readIds.has(r.id)).length
  const unread = markedAll ? 0 : Math.max(0, data.unread - locallyRead)

  return (
    <div className="af-nt">
      <header className="af-nt-head">
        <div>
          <h1 className="af-display af-nt-title">{copy('Notifications')}</h1>
          <p className="af-nt-sub" data-testid="notifications-count">
            {unread > 0
              ? m.unread(unread.toLocaleString(language === 'es' ? 'es' : 'en'), !!data.leagueId)
              : data.leagueId
                ? copy('Nothing is waiting on you in this league.')
                : copy('Nothing is waiting on you.')}
            {/*
              * Only when the "Needs action" section is really there. The old line promised "the ones
              * with a clock on them are at the top" on every visit, with or without that section.
              */}
            {data.actToday.length > 0 ? (
              <span className="af-nt-sub-action" data-testid="notifications-need-action"> · {m.needAction(data.actToday.length)}</span>
            ) : null}
          </p>
        </div>
        {/*
          * ⚠ GATED ON THE TRUE COUNT, NOT ON THE LISTED ROWS. This tested
          * `data.rest.every(read)`, so once the newest 60 were read the button
          * went disabled while older unread rows still existed - leaving the
          * only control that can clear them unreachable, in exactly the state
          * where a user most wants it. `ids: 'all'` clears them server-side.
          */}
        {/* In plain sight since 2026-11-14: it was the only item inside a ⋯ menu. */}
        <button
          type="button"
          className="af-nt-markall"
          data-testid="notifications-mark-all"
          onClick={() => markRead('all')}
          disabled={marking || unread === 0}
        >
          {copy(marking ? 'Marking…' : 'Mark all read')}
        </button>
      </header>
      {readError ? <p role="alert">{copy(readError)}</p> : null}

      <details className="af-nt-settings">
        <summary>{copy('Alert settings')}</summary>
        <Link href="/settings?tab=notifications">{copy('Manage delivery preferences')}</Link>
      {/* Web push and web install only — hidden inside the iOS app, wrapper included, so no empty box. */}
      <div className="af-nt-push" data-hide-in-ios-app>
        <EnableWebPushCard />
        {/*
          ⚠ INSTALLING IS A PREREQUISITE FOR ALERTS ON IPHONE, NOT A SEPARATE FEATURE.
          Safari only permits notifications for a site added to the Home Screen, which
          `EnableWebPushCard` already says in words — this turns that instruction into a
          button. Hidden once installed: an installed user has no reason to see it.
        */}
        <div className="af-nt-push-install">
          <InstallButton hideWhenInstalled />
        </div>
      </div>
      {/* The app's own alerts card; renders nothing outside the iOS app. */}
      <IosAppPushCard className="af-nt-push" />
      {/*
        The suppression rule, stated to the user. It is the design principle of
        the whole surface, so it is copy rather than a footnote.
      */}
      {data.push.suppressedReason ? (
        <footer className="af-nt-foot">
          <p className="af-nt-foot-t">{copy('Why your phone stayed quiet')}</p>
          <p className="af-nt-foot-b">{copy(data.push.suppressedReason)}</p>
          <p className="af-nt-foot-b">
            {copy('At this many leagues the job is holding things back, not sending them. Anything without a deadline waits here instead of ringing.')}
          </p>
          <Link href="/settings?tab=notifications" className="af-nt-foot-link">
            {copy('Change what gets through')}
          </Link>
        </footer>
      ) : null}

      </details>
      <div className="af-nt-filters" role="group" aria-label={copy('Filter notifications')}>
        <button type="button" className="af-nt-filter" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{copy('All')}</button>
        <button type="button" className="af-nt-filter" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>{m.unreadFilter}</button>
        {!data.leagueId && leagues.length > 0 ? (
          <select className="af-nt-filter" aria-label={copy('League')} value={league} onChange={(event) => setLeague(event.target.value)}>
            <option value="">{copy('All leagues')}</option>
            {leagues.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        ) : null}
        <select className="af-nt-filter" aria-label={copy('Category')} value={filter} onChange={(event) => setFilter(event.target.value as NotificationFilter)}>
          {visibleFilters(data.mentionsAvailable || data.rest.some((row) => row.kind === 'mentions')).map(({id}) => <option key={id} value={id}>{id === 'all' ? copy('All categories') : filterLabel(id)}</option>)}
        </select>
      </div>

      {actToday.length > 0 ? (
        <section className="af-nt-section" data-tier="urgent">
          <h2 className="af-nt-sectiontitle">{copy('Needs action')}</h2>
          <ul className="af-nt-list">
            {actToday.map((r) => (
              <Row key={r.id} row={r} urgent />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="af-nt-section">
        <h2 className="af-nt-sectiontitle">{copy('Recent')}</h2>
        {feed.length > 0 ? (
          <ul className="af-nt-list">
            {feed.map((item, index) => {
              const createdAt = item.type === 'news' ? item.createdAt : item.row.createdAt
              const date = dayOf(createdAt)
              const previous = feed[index - 1]
              const startsDay = !previous || dayOf(previous.type === 'news' ? previous.createdAt : previous.row.createdAt) !== date
              if (item.type === 'news') {
                return <Fragment key={item.key}>
                  {startsDay ? <li className="af-nt-day"><h3>{date}</h3></li> : null}
                  <NewsGroupRow sport={item.sport} rows={item.rows} read={item.read} onRead={(id) => markRead([id])} />
                </Fragment>
              }
              const r = item.row
              return <NotificationDayRow key={r.id} date={startsDay ? date : null} row={r}
                groupedRows={r.relatedIds && r.relatedIds.length > 1 ? data.rest.filter((item) => r.relatedIds?.includes(item.id)) : undefined}
                onRead={(id) => markRead([id])} />
            })}
          </ul>
        ) : (
          <p className="af-nt-empty">
            {unreadOnly ? copy('No unread notifications here.') : filter === 'all'
              ? data.leagueId
                ? copy('No notifications on file for this league. This is a log of things that happened — an empty one means nothing has here, not that we stopped watching.')
                : copy('No notifications on file. This is a log of things that happened — an empty one means nothing has, not that we stopped watching.')
              : m.nothingUnder(filterLabel(filter))}
          </p>
        )}
        {/*
          * The window, said once, under the list (2026-11-14). It used to sit above the list and
          * claim "the counts above describe this page"; the count above is the account's true
          * unread total and the chips no longer show counts, so that sentence had become false.
          */}
        {data.olderNotListed > 0 && feed.length > 0 ? (
          <p className="af-nt-sectionnote" data-testid="notifications-window">{m.showingNewest(data.listed)}</p>
        ) : null}
      </section>


    </div>
  )
}

export default NotificationsCenter
