/**
 * "Send to AllFantasy" — a bookmarklet that hands the Yahoo page the commissioner is LOOKING AT to an
 * AllFantasy window, so a page goes in with one click instead of Ctrl+A, Ctrl+C, switch tab, paste.
 *
 * 🛑 IT IS COPY-PASTE WITHOUT THE COPYING, AND MUST STAY THAT. It runs only when the commissioner
 * clicks it, in their own browser, on the page already on their screen, and reads that page's visible
 * text. It never navigates Yahoo, never touches a Yahoo credential, and our servers never contact
 * Yahoo. Teaching it to walk the team pages by itself would turn it into the automated access Yahoo's
 * terms forbid — one click, one page.
 *
 * HOW THE HAND-OFF WORKS, AND WHY THIS SHAPE. A request from Yahoo's page to our API would be
 * cross-site, so it would not carry the AllFantasy session cookie. Instead the bookmarklet opens a
 * signed-in AllFantasy window (`/import/yahoo-receive`) and the two talk by `postMessage`:
 *
 *   1. receiver → opener   { type: 'af-yahoo-ready' }   addressed to Yahoo's origin only
 *   2. opener → receiver   { type: 'af-yahoo-page', url, text }   addressed to our origin only
 *
 * Each side checks the other's ORIGIN and that the message came from the exact window it expects.
 *
 * 🛑 AND EACH WINDOW LOAD HAS ITS OWN `rid`, BECAUSE THE FIRST VERSION LOST PAGES. It answered the
 * first "ready" and stopped listening. Clicking the bookmark again within ~20s re-navigates a window
 * whose OLD page is still saying "ready" — the bookmark answered the dying page, and the new one
 * waited forever. Measured 2026-11-14 on a real league: two of four quick clicks were lost. Now the
 * bookmark answers EVERY ready (echoing its `rid`), the receiver accepts only its own `rid`, and a
 * new click retires the previous click's listener — Yahoo changes pages without reloading, so an old
 * listener would otherwise answer with an old page.
 * Measured 2026-11-14 on a real league page: Yahoo sends no Cross-Origin-Opener-Policy (the window
 * link survives), and its CSP is only `sandbox` with allow-scripts, allow-popups and
 * allow-popups-to-escape-sandbox — so the bookmarklet runs and may open our window.
 *
 * ⚠ THE BOOKMARKLET IS A STRING, NOT `fn.toString()`. A bundler may rename or inline anything in a
 * real function, and the bookmark a user saved months ago must keep working. Plain ES5, values
 * injected with JSON.stringify.
 */

export const YAHOO_FOOTBALL_ORIGIN = 'https://football.fantasysports.yahoo.com'
export const YAHOO_SNAPSHOT_RECEIVER_PATH = '/import/yahoo-receive'
export const YAHOO_SNAPSHOT_WINDOW_NAME = 'af-yahoo-receive'
export const YAHOO_READY_MESSAGE = 'af-yahoo-ready'
export const YAHOO_PAGE_MESSAGE = 'af-yahoo-page'
/** Same bound the paste route enforces; the server re-checks it either way. */
export const YAHOO_BOOKMARKLET_MAX_TEXT = 200_000

/** The `javascript:` URL to put in a link the commissioner drags to their bookmarks bar. */
/**
 * `receiverPath` exists for the design harness (/e2e/yahoo-receive) only; production always uses the
 * signed-in receiver.
 */
export function buildYahooSnapshotBookmarklet(afOrigin: string, receiverPath: string = YAHOO_SNAPSHOT_RECEIVER_PATH): string {
  const af = new URL(afOrigin).origin
  const code =
    '(function(){' +
    `var AF=${JSON.stringify(af)},Y=${JSON.stringify(YAHOO_FOOTBALL_ORIGIN)},P=${JSON.stringify(receiverPath)};` +
    "if(location.origin!==Y||!/^\\/f1\\/\\d+/.test(location.pathname)){alert('Open your Yahoo Fantasy Football league page first, then click Send to AllFantasy.');return}" +
    `var msg={type:${JSON.stringify(YAHOO_PAGE_MESSAGE)},v:1,url:location.href,text:String(document.body.innerText||'').slice(0,${YAHOO_BOOKMARKLET_MAX_TEXT})};` +
    `var w=window.open(AF+P,${JSON.stringify(YAHOO_SNAPSHOT_WINDOW_NAME)});` +
    "if(!w){alert('Your browser blocked the AllFantasy window. Allow pop-ups for this Yahoo page, then click Send to AllFantasy again.');return}" +
    `function on(e){if(e.origin!==AF||e.source!==w||!e.data||e.data.type!==${JSON.stringify(YAHOO_READY_MESSAGE)})return;` +
    'msg.rid=String(e.data.rid||"");w.postMessage(msg,AF)}' +
    // A new click retires the previous click's listener on this page.
    'if(window.__afYahooOn)window.removeEventListener("message",window.__afYahooOn);' +
    'window.__afYahooOn=on;window.addEventListener("message",on);' +
    // Long enough to sign in first if the AllFantasy session had expired.
    'setTimeout(function(){if(window.__afYahooOn===on){window.removeEventListener("message",on);window.__afYahooOn=null}},600000)' +
    '})()'
  return `javascript:${encodeURIComponent(code)}`
}

export type YahooPageMessageResult =
  | { ok: true; url: string; text: string }
  | { ok: false; reason: 'origin' | 'shape' | 'rid' | 'url' | 'empty' | 'size' }

/**
 * Validate a `message` event the receiver got. Pure, so the exact rules are tested rather than
 * trusted. The receiver ALSO checks `event.source === window.opener`, which needs a live window.
 */
export function parseYahooPageMessage(
  event: { origin: string; data: unknown },
  /** The `rid` this window load sent with its "ready". A reply to anyone else's ready is not ours. */
  expectedRid: string,
): YahooPageMessageResult {
  if (event.origin !== YAHOO_FOOTBALL_ORIGIN) return { ok: false, reason: 'origin' }
  const d = event.data as Record<string, unknown> | null
  if (!d || typeof d !== 'object' || d.type !== YAHOO_PAGE_MESSAGE || typeof d.url !== 'string' || typeof d.text !== 'string') {
    return { ok: false, reason: 'shape' }
  }
  if (d.rid !== expectedRid) return { ok: false, reason: 'rid' }
  let url: URL
  try {
    url = new URL(d.url)
  } catch {
    return { ok: false, reason: 'url' }
  }
  if (url.origin !== YAHOO_FOOTBALL_ORIGIN || !/^\/f1\/\d+/.test(url.pathname)) return { ok: false, reason: 'url' }
  const text = d.text.trim()
  if (!text) return { ok: false, reason: 'empty' }
  if (text.length > YAHOO_BOOKMARKLET_MAX_TEXT) return { ok: false, reason: 'size' }
  return { ok: true, url: url.href, text }
}
