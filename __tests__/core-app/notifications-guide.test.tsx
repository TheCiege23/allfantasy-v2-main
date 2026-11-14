/**
 * Notifications in plain words (2026-11-14): the unread count with Mark all read in sight, each
 * sport's news folded into one row per day with links to the stories, one line per league on a
 * lineup alert, the window said once under the list, and a delivery menu in everyday words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { NotificationRow, NotificationsCenterData } from '@/lib/core-app/notificationsCenter'
import {
  commonSource, deliveryLines, detailLines, groupNewsByDay, headlineOf, isSportsNewsType, newsStoryLink, showLeagueTag,
} from '@/lib/core-app/notificationsGuide'
import { notificationsCenterMessages } from '@/lib/core-app/messages/notificationsCenter'

const lang = vi.hoisted(() => ({ value: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.value }) }))
vi.mock('@/components/notifications/EnableWebPushCard', () => ({ EnableWebPushCard: () => null }))
vi.mock('@/components/notifications/IosAppPushCard', () => ({ IosAppPushCard: () => null }))
vi.mock('@/components/pwa/PWAActions', () => ({ InstallButton: () => null }))
vi.mock('@/components/core-app/screens/NotificationRowMute', () => ({ NotificationRowMute: () => null }))

import { NotificationsCenter } from '@/components/core-app/screens/NotificationsCenter'

afterEach(() => { cleanup(); lang.value = 'en' })

const row = (id: string, o: Partial<NotificationRow> = {}): NotificationRow => ({
  id, kind: 'lineups', title: 'Check your lineup', detail: 'A starter is out',
  leagueId: 'league1', leagueName: 'Top Shelf Cartel', platform: 'sleeper',
  createdAt: '2026-11-14T12:00:00Z', read: false, severity: 'warn',
  action: { label: 'Review lineup', href: '/core/my-team?league=league1', external: false },
  ...o,
})
const news = (id: string, sport: string, headline: string, o: Partial<NotificationRow> = {}): NotificationRow => row(id, {
  kind: 'news', type: 'sports_news', title: `${sport} news`, detail: `${headline} — via ESPN`,
  leagueId: null, leagueName: null, platform: null, severity: 'info',
  meta: { sport, source: 'ESPN' },
  action: { label: 'Read on ESPN', href: `https://www.espn.com/${id}`, external: true },
  ...o,
})
const data = (o: Partial<NotificationsCenterData> = {}): NotificationsCenterData => ({
  actToday: [], rest: [],
  counts: { all: 0, trades: 0, waivers: 0, lineups: 0, mentions: 0, drafts: 0, commissioner: 0, news: 0 },
  unread: 0, listed: 0, olderNotListed: 0, leagueId: null, mentionsAvailable: false,
  push: { delivered: [], suppressedCount: 0, suppressedLeagues: 0, suppressedReason: null },
  ...o,
})

describe('the rules', () => {
  it('knows which types are sports news', () => {
    expect(isSportsNewsType('sports_news')).toBe(true)
    expect(isSportsNewsType('breaking_news')).toBe(true)
    expect(isSportsNewsType('player_news_update')).toBe(false)
    expect(isSportsNewsType(null)).toBe(false)
  })

  it('links a story over https only, named for its outlet', () => {
    expect(newsStoryLink({ sourceUrl: 'https://www.espn.com/a', source: 'ESPN' })).toEqual({ href: 'https://www.espn.com/a', label: 'Read on ESPN' })
    expect(newsStoryLink({ actionHref: 'https://www.cbssports.com/b' })).toEqual({ href: 'https://www.cbssports.com/b', label: 'Read on cbssports.com' })
    expect(newsStoryLink({ sourceUrl: 'http://www.espn.com/a' })).toBeNull()
    expect(newsStoryLink({ sourceUrl: 'javascript:alert(1)' })).toBeNull()
    expect(newsStoryLink({ sourceUrl: '/core/live' })).toBeNull()
    expect(newsStoryLink(null)).toBeNull()
  })

  it("folds one sport's news for one day into one item, where its newest story was", () => {
    const rows = [
      news('n1', 'NCAAB', 'Iowa faces Creighton'),
      row('lineup'),
      news('n2', 'NCAAB', 'Memphis hosts Louisville', { read: true }),
      news('b1', 'NCAAB', 'Coach fired midseason', { type: 'breaking_news', title: '🚨 NCAAB coaching change' }),
      news('h1', 'NHL', 'Staal returns'),
      news('n3', 'NCAAB', 'Baylor and Texas square off', { createdAt: '2026-11-13T12:00:00Z' }),
    ]
    const items = groupNewsByDay(rows)
    expect(items.map((i) => (i.type === 'news' ? `news:${i.sport}:${i.rows.length}` : i.row.id))).toEqual([
      'news:NCAAB:2', 'lineup', 'b1', 'h1', 'n3',
    ])
    const first = items[0]
    expect(first.type === 'news' && first.read).toBe(false)
    expect(first.type === 'news' && first.createdAt).toBe('2026-11-14T12:00:00Z')
  })

  it('reads a group as read only when every story in it is', () => {
    const items = groupNewsByDay([news('a', 'NBA', 'x', { read: true }), news('b', 'NBA', 'y', { read: true })])
    expect(items[0].type === 'news' && items[0].read).toBe(true)
  })

  it('splits a per-league detail into lines and drops the one-league tag for it', () => {
    expect(detailLines('A: start X.\nB: start Y.\n\n')).toEqual(['A: start X.', 'B: start Y.'])
    expect(showLeagueTag({ leagueName: 'A', detail: 'A: start X.\nB: start Y.' })).toBe(false)
    expect(showLeagueTag({ leagueName: 'A', detail: 'Start X.' })).toBe(true)
    expect(showLeagueTag({ leagueName: null, detail: 'x' })).toBe(false)
    // A one-line detail that already opens with the league's name: the tag would say it twice.
    expect(showLeagueTag({ leagueName: 'Top Shelf Cartel', detail: 'Top Shelf Cartel: check free agents.' })).toBe(false)
  })

  it('names the outlet once for a group, and only strips a tail that names it', () => {
    const espn = { meta: { source: 'ESPN' }, detail: 'Iowa faces Creighton — via ESPN' }
    expect(headlineOf(espn)).toBe('Iowa faces Creighton')
    expect(headlineOf({ meta: { source: 'ESPN' }, detail: 'Fans travel via ESPN bus' })).toBe('Fans travel via ESPN bus')
    expect(headlineOf({ meta: {}, detail: 'x — via ESPN' })).toBe('x — via ESPN')
    expect(commonSource([{ meta: { source: 'ESPN' } }, { meta: { source: 'ESPN' } }])).toBe('ESPN')
    expect(commonSource([{ meta: { source: 'ESPN' } }, { meta: { source: 'CBS' } }])).toBeNull()
    expect(commonSource([{ meta: {} }])).toBeNull()
  })

  it('says where a notice went in everyday words', () => {
    expect(deliveryLines({ delivery: {
      mobile: { status: 'accepted' }, desktop: { status: 'partial' },
      email: { status: 'suppressed' }, sms: { status: 'failed', reason: 'quiet_hours' },
    } })).toEqual([
      { channel: 'phoneTablet', result: 'sent' },
      { channel: 'desktop', result: 'someDevices' },
      { channel: 'email', result: 'notSent' },
      { channel: 'text', result: 'quietHours' },
    ])
    expect(deliveryLines({ delivery: { push: { status: 'delayed' }, email: {} } })).toEqual([{ channel: 'phone', result: 'retrying' }])
    expect(deliveryLines({ delivery: { push: { status: 'x', reason: 'no_subscriptions' } } })).toEqual([{ channel: 'phone', result: 'noDevice' }])
    expect(deliveryLines(null)).toEqual([])
  })
})

describe('the page', () => {
  it('says how many are unread, with Mark all read in sight and no clock promise', () => {
    render(<NotificationsCenter data={data({ unread: 2108, rest: [row('a')], listed: 1 })} />)
    expect(screen.getByTestId('notifications-count').textContent).toBe('2,108 unread')
    expect(screen.queryByTestId('notifications-need-action')).toBeNull()
    expect(document.body.textContent).not.toMatch(/clock on them/)
    expect(screen.queryByLabelText('Notification actions')).toBeNull()
    const markAll = screen.getByTestId('notifications-mark-all') as HTMLButtonElement
    expect(markAll.textContent).toBe('Mark all read')
    expect(markAll.disabled).toBe(false)
  })

  it('points at the top only when something there needs action', () => {
    const urgent = row('issue:1', { title: 'Fix your lineup', detail: 'Locks in 1h' })
    render(<NotificationsCenter data={data({ unread: 3, actToday: [urgent] })} />)
    expect(screen.getByTestId('notifications-need-action').textContent).toContain("1 needs action — it's at the top.")
    expect(screen.getByRole('heading', { name: 'Needs action' })).toBeTruthy()
  })

  it("shows one row per sport's news for the day, opening to the stories", () => {
    const rows = [
      news('n1', 'NCAAB', 'Iowa faces Creighton'),
      news('n2', 'NCAAB', 'Memphis hosts Louisville'),
      news('n3', 'NCAAB', 'Baylor and Texas square off'),
      news('b1', 'NFL', 'Vikings call the Raiders', { type: 'breaking_news', title: '🚨 NFL Trade (report)' }),
    ]
    render(<NotificationsCenter data={data({ unread: 4, rest: rows, listed: 4 })} />)
    const groups = screen.getAllByTestId('notification-news-group')
    expect(groups).toHaveLength(1)
    expect(groups[0].textContent).toContain('NCAAB news')
    expect(groups[0].textContent).toContain('3 stories from ESPN')
    const links = within(groups[0]).getAllByRole('link')
    // The outlet is said once, in the summary, not on every headline.
    expect(links[0].textContent).toBe('Iowa faces Creighton ↗')
    // All three arrived together, so the time is said once too.
    expect(groups[0].querySelectorAll('.af-nt-headlines .af-nt-time')).toHaveLength(0)
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://www.espn.com/n1', 'https://www.espn.com/n2', 'https://www.espn.com/n3'])
    expect(links.every((a) => a.getAttribute('target') === '_blank' && a.getAttribute('rel') === 'noopener noreferrer')).toBe(true)
    // A breaking story keeps its own row, and opens the story.
    const breaking = screen.getByRole('link', { name: 'Read on ESPN · 🚨 NFL Trade (report)' })
    expect(breaking.getAttribute('href')).toBe('https://www.espn.com/b1')
  })

  it('reads a lineup alert one line per league, without one league tag claiming it all', () => {
    const multi = row('m', {
      title: '🚨 David Montgomery is OUT — your lineup options', leagueName: '33 1/3% Active',
      detail: 'Not 4 the Weak!: start Rhamondre Stevenson.\n33 1/3% Active: start AJ Barner.\nIts Just Too Deep!: start Anthony Gould.',
    })
    const single = row('s', { title: '🚨 Cale Makar is OUT — your lineup options', detail: 'Top Shelf Cartel: check free agents.' })
    render(<NotificationsCenter data={data({ unread: 2, rest: [multi, single], listed: 2 })} />)
    const lines = screen.getByTestId('notification-lines')
    expect(lines.children).toHaveLength(3)
    expect(lines.children[1].textContent).toBe('33 1/3% Active: start AJ Barner.')
    const rows = document.querySelectorAll('.af-nt-row')
    expect(rows[0].querySelector('.af-nt-league')).toBeNull()
    expect(rows[1].querySelector('.af-nt-league')).toBeNull()
    expect(rows[1].textContent).toContain('Top Shelf Cartel: check free agents.')
  })

  it("keeps a one-league notice's tag when its detail does not name the league", () => {
    render(<NotificationsCenter data={data({ unread: 1, rest: [row('i', { title: 'NYJ: injury update', detail: 'Wilson nears clearance.' })], listed: 1 })} />)
    expect(document.querySelector('.af-nt-league')?.textContent).toBe('Top Shelf Cartel')
  })

  it("shows a headline's time only when it differs from the one above it", () => {
    const rows = [
      news('n1', 'NCAAF', 'First', { createdAt: new Date(Date.now() - 60_000).toISOString() }),
      news('n2', 'NCAAF', 'Second', { createdAt: new Date(Date.now() - 13 * 60_000).toISOString() }),
      news('n3', 'NCAAF', 'Third', { createdAt: new Date(Date.now() - 13 * 60_000).toISOString() }),
    ]
    render(<NotificationsCenter data={data({ unread: 3, rest: rows, listed: 3 })} />)
    const items = [...screen.getByTestId('notification-news-group').querySelectorAll('.af-nt-headlines li')]
    expect(items.map((li) => li.querySelector('.af-nt-time')?.textContent ?? null)).toEqual([null, '13m ago', null])
  })

  it('says the window once, under the list, and only when older ones exist', () => {
    const { unmount } = render(<NotificationsCenter data={data({ unread: 1, rest: [row('a')], listed: 60, olderNotListed: 6393 })} />)
    const note = screen.getByTestId('notifications-window')
    expect(note.textContent).toBe('Showing your newest 60.')
    expect(note.previousElementSibling?.tagName).toBe('UL')
    expect(document.body.textContent).not.toMatch(/counts above/)
    unmount()
    render(<NotificationsCenter data={data({ unread: 1, rest: [row('a')], listed: 1 })} />)
    expect(screen.queryByTestId('notifications-window')).toBeNull()
  })

  it('lists where a notice went in everyday words', () => {
    const r = row('a', { meta: { delivery: { mobile: { status: 'accepted' }, email: { status: 'suppressed' } } } })
    render(<NotificationsCenter data={data({ unread: 1, rest: [r], listed: 1 })} />)
    const items = [...screen.getByTestId('notification-delivery').querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toEqual(['In your inbox here', 'Phone and tablet · sent', 'Email · not sent'])
    expect(document.body.textContent).not.toMatch(/Accepted by provider/)
  })

  it('filters to News from the category menu', () => {
    const rows = [news('n1', 'NBA', 'Hart searches for answers'), row('lineup', { title: 'Lineup alert' })]
    render(<NotificationsCenter data={data({ unread: 2, rest: rows, listed: 2 })} />)
    const category = screen.getByRole('combobox', { name: 'Category' }) as HTMLSelectElement
    expect([...category.options].map((o) => o.textContent)).toContain('News')
    fireEvent.change(category, { target: { value: 'news' } })
    expect(screen.queryByText('Lineup alert')).toBeNull()
    expect(screen.getByText('NBA news')).toBeTruthy()
  })
})

describe('Spanish', () => {
  it('says all of it in Spanish', () => {
    lang.value = 'es'
    const rows = [
      news('n1', 'NCAAB', 'Iowa faces Creighton'),
      news('n2', 'NCAAB', 'Memphis hosts Louisville'),
      news('h1', 'NHL', 'Staal returns'),
      row('a', { meta: { delivery: { push: { status: 'accepted' }, email: { status: 'suppressed' } } } }),
    ]
    render(<NotificationsCenter data={data({ unread: 2108, rest: rows, listed: 60, olderNotListed: 9 })} />)
    expect(screen.getByTestId('notifications-count').textContent).toBe('2108 sin leer')
    expect(screen.getByTestId('notification-news-group').textContent).toContain('Noticias de NCAAB')
    expect(screen.getByTestId('notification-news-group').textContent).toContain('2 noticias de ESPN')
    expect(screen.getByText('Noticias de NHL')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sin leer' })).toBeTruthy()
    expect(screen.getByTestId('notifications-window').textContent).toBe('Se muestran tus 60 avisos más recientes.')
    const delivery = [...screen.getAllByTestId('notification-delivery').at(-1)!.querySelectorAll('li')].map((li) => li.textContent)
    expect(delivery).toEqual(['En tu bandeja de aquí', 'Teléfono · enviado', 'Correo · no enviado'])
    const category = screen.getAllByRole('combobox').at(-1) as HTMLSelectElement
    expect([...category.options].map((o) => o.textContent)).toContain('Noticias')
  })

  it('has every key in both languages and never says «waiver»', () => {
    const en = notificationsCenterMessages.en as Record<string, unknown>
    const es = notificationsCenterMessages.es as Record<string, unknown>
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    const text = Object.values(es).map((v) => (typeof v === 'function' ? String((v as (...a: unknown[]) => unknown)(2, false)) : String(v))).join(' ')
    expect(text).not.toMatch(/waiver/i)
  })
})
