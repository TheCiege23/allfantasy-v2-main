/**
 * The "Send to AllFantasy" bookmark and the receiver's message check.
 *
 * The bookmark is a string that runs on Yahoo's page, so the most honest test is to RUN that exact
 * string against fake windows and watch what it posts. Two failure modes are pinned here because both
 * happened or nearly happened:
 *   - answering only the FIRST "ready" lost pages when a click re-used a window whose old page was
 *     still announcing itself (measured on a real league, 2026-11-14);
 *   - an older click's listener answering for a newer click would send the WRONG page, because Yahoo
 *     changes pages without reloading.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildYahooSnapshotBookmarklet,
  parseYahooPageMessage,
  YAHOO_FOOTBALL_ORIGIN,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotBookmarklet'

const AF = 'https://www.allfantasy.ai'

type Listener = (e: { origin: string; source: unknown; data: unknown }) => void

/** A fake Yahoo page that can run the bookmark and deliver messages to it. */
function fakeYahooPage(opts: { href: string; text: string; popupBlocked?: boolean }) {
  const url = new URL(opts.href)
  const listeners = new Set<Listener>()
  const posted: Array<{ data: any; target: string }> = []
  // Real postMessage copies the message at send time (structured clone); so does this fake.
  const popup = { postMessage: (data: unknown, target: string) => posted.push({ data: structuredClone(data), target }) }
  const alerts: string[] = []
  const win: Record<string, any> = {
    open: vi.fn(() => (opts.popupBlocked ? null : popup)),
    addEventListener: (_t: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_t: string, fn: Listener) => listeners.delete(fn),
  }
  const doc = { body: { innerText: opts.text } }
  const location = { origin: url.origin, pathname: url.pathname, href: url.href }
  const run = (bookmark: string) => {
    const code = decodeURIComponent(bookmark.slice('javascript:'.length))
    // eslint-disable-next-line no-new-func -- executing the exact bookmark string is the point
    new Function('window', 'location', 'document', 'alert', 'setTimeout', code)(
      win,
      location,
      doc,
      (m: string) => alerts.push(m),
      () => 0,
    )
  }
  const deliver = (e: { origin: string; source: unknown; data: unknown }) => [...listeners].forEach((fn) => fn(e))
  return { run, deliver, popup, posted, alerts, win, listeners, setText: (t: string) => (doc.body.innerText = t) }
}

describe('buildYahooSnapshotBookmarklet', () => {
  it('is a javascript: URL whose code parses and names only our origin and the receiver path', () => {
    const bm = buildYahooSnapshotBookmarklet(`${AF}/import?x=1`)
    expect(bm.startsWith('javascript:')).toBe(true)
    const code = decodeURIComponent(bm.slice(11))
    // eslint-disable-next-line no-new-func
    expect(() => new Function(code)).not.toThrow()
    expect(code).toContain(JSON.stringify(AF)) // origin only — the query string is dropped
    expect(code).toContain('"/import/yahoo-receive"')
  })
})

describe('the bookmark, run against a fake Yahoo page', () => {
  const bm = buildYahooSnapshotBookmarklet(AF)

  it('refuses to run anywhere but a Yahoo football league page', () => {
    const page = fakeYahooPage({ href: 'https://sports.yahoo.com/nfl/', text: 'x' })
    page.run(bm)
    expect(page.win.open).not.toHaveBeenCalled()
    expect(page.alerts[0]).toMatch(/league page first/)
  })

  it('says so when the pop-up is blocked', () => {
    const page = fakeYahooPage({ href: `${YAHOO_FOOTBALL_ORIGIN}/f1/1361311/settings`, text: 'x', popupBlocked: true })
    page.run(bm)
    expect(page.alerts[0]).toMatch(/blocked/)
  })

  it('opens the receiver and answers EVERY ready from it with that ready\'s rid', () => {
    const page = fakeYahooPage({ href: `${YAHOO_FOOTBALL_ORIGIN}/f1/1361311/settings`, text: 'League Settings ...' })
    page.run(bm)
    expect(page.win.open).toHaveBeenCalledWith(`${AF}/import/yahoo-receive`, 'af-yahoo-receive')

    // The dying old page and the new one both announce themselves; both get an answer addressed to them.
    page.deliver({ origin: AF, source: page.popup, data: { type: 'af-yahoo-ready', rid: 'old' } })
    page.deliver({ origin: AF, source: page.popup, data: { type: 'af-yahoo-ready', rid: 'new' } })
    expect(page.posted.map((p) => [p.data.rid, p.target])).toEqual([
      ['old', AF],
      ['new', AF],
    ])
    expect(page.posted[1]!.data).toMatchObject({
      type: 'af-yahoo-page',
      url: `${YAHOO_FOOTBALL_ORIGIN}/f1/1361311/settings`,
      text: 'League Settings ...',
    })
  })

  it('ignores a ready from another origin or another window', () => {
    const page = fakeYahooPage({ href: `${YAHOO_FOOTBALL_ORIGIN}/f1/1361311`, text: 'x' })
    page.run(bm)
    page.deliver({ origin: 'https://evil.test', source: page.popup, data: { type: 'af-yahoo-ready', rid: 'a' } })
    page.deliver({ origin: AF, source: {}, data: { type: 'af-yahoo-ready', rid: 'a' } })
    expect(page.posted).toHaveLength(0)
  })

  it('a second click retires the first, so an old page is never sent for a new click', () => {
    const page = fakeYahooPage({ href: `${YAHOO_FOOTBALL_ORIGIN}/f1/1361311/settings`, text: 'SETTINGS PAGE' })
    page.run(bm)
    // Yahoo navigates in-page; the commissioner clicks again on the draft page.
    page.setText('DRAFT PAGE')
    page.run(bm)
    expect(page.listeners.size).toBe(1)
    page.deliver({ origin: AF, source: page.popup, data: { type: 'af-yahoo-ready', rid: 'r' } })
    expect(page.posted.map((p) => p.data.text)).toEqual(['DRAFT PAGE'])
  })
})

describe('parseYahooPageMessage (the receiver\'s check)', () => {
  const good = { type: 'af-yahoo-page', v: 1, url: `${YAHOO_FOOTBALL_ORIGIN}/f1/1361311/draftresults`, text: 'Draft Results', rid: 'r1' }

  it('accepts its own reply from Yahoo', () => {
    expect(parseYahooPageMessage({ origin: YAHOO_FOOTBALL_ORIGIN, data: good }, 'r1')).toEqual({
      ok: true,
      url: good.url,
      text: 'Draft Results',
    })
  })

  it.each([
    [{ origin: 'https://evil.test', data: good }, 'origin'],
    [{ origin: 'https://sports.yahoo.com', data: good }, 'origin'],
    [{ origin: YAHOO_FOOTBALL_ORIGIN, data: { ...good, rid: 'someone-else' } }, 'rid'],
    [{ origin: YAHOO_FOOTBALL_ORIGIN, data: { ...good, type: 'other' } }, 'shape'],
    [{ origin: YAHOO_FOOTBALL_ORIGIN, data: { ...good, url: 'https://evil.test/f1/1' } }, 'url'],
    [{ origin: YAHOO_FOOTBALL_ORIGIN, data: { ...good, url: `${YAHOO_FOOTBALL_ORIGIN}/nba/1` } }, 'url'],
    [{ origin: YAHOO_FOOTBALL_ORIGIN, data: { ...good, text: '   ' } }, 'empty'],
    [{ origin: YAHOO_FOOTBALL_ORIGIN, data: { ...good, text: 'x'.repeat(200_001) } }, 'size'],
    [{ origin: YAHOO_FOOTBALL_ORIGIN, data: null }, 'shape'],
  ])('refuses %#', (event, reason) => {
    expect(parseYahooPageMessage(event as never, 'r1')).toEqual({ ok: false, reason })
  })
})
