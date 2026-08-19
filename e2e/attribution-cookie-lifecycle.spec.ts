import { expect, test, type BrowserContext } from '@playwright/test'

/**
 * Browser-level certification of the campaign attribution cookie chain.
 *
 * This exists because the unit suite cannot prove the property that actually matters:
 * that a REAL browser, with a real cookie jar, carries first-touch and latest-touch
 * across navigations the way the funnel depends on. The cookies are httpOnly, so page
 * scripts cannot observe them — Playwright's `context.cookies()` reads them out of the
 * jar directly, which is the only way to assert on them from outside the server.
 *
 * Runs against the local dev server. A local PRODUCTION build is deliberately NOT used:
 * the cookies set `secure: true` when NODE_ENV === 'production', so a production build
 * served over plain http could never set them and the run would fail for a reason that
 * has nothing to do with the logic under test. The production `secure` flag is asserted
 * in __tests__/attribution-middleware-capture.test.ts instead.
 *
 * No database writes are involved: middleware sets these cookies before any route
 * handler runs, so this spec exercises the chain without persisting anything.
 */

const ANON = 'af_anon_id'
const FIRST = 'af_attr_first'
const LATEST = 'af_attr_last'

type Touch = {
  p?: string
  s?: string
  m?: string
  c?: string
  ct?: string
  t?: string
  ci?: string
  rc?: string
  lp?: string
  rh?: string
  at?: string
}

async function readCookie(context: BrowserContext, name: string) {
  const all = await context.cookies()
  return all.find((c) => c.name === name)
}

/**
 * Decode until it parses. The jar value is DOUBLE percent-encoded — encodeTouch encodes,
 * then NextResponse.cookies.set() encodes again — so a single fixed decode reads back
 * `%7B%22p%22...` and fails. Mirrors decodeTouch's tolerance in lib/analytics/attribution.ts.
 */
async function readTouch(context: BrowserContext, name: string): Promise<Touch | null> {
  const cookie = await readCookie(context, name)
  if (!cookie) return null

  let candidate = cookie.value
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      return JSON.parse(candidate) as Touch
    } catch {
      const next = decodeURIComponent(candidate)
      if (next === candidate) return null
      candidate = next
    }
  }
  return null
}

const TIKTOK =
  '/?utm_source=tiktok&utm_medium=social&utm_campaign=launch_a&utm_content=slide-3&utm_term=dynasty&af_cid=camp_100&ref=CIEGE'
const INSTAGRAM = '/?utm_source=instagram&utm_medium=social&utm_campaign=retarget_b&utm_content=story-1'
const X_CAMPAIGN = '/?utm_source=twitter&utm_medium=social&utm_campaign=thread_c'

test.describe('campaign attribution cookie lifecycle', () => {
  test('captures a full tracked TikTok link and normalizes the platform', async ({ page, context }) => {
    await page.goto(TIKTOK)

    const anon = await readCookie(context, ANON)
    expect(anon, 'anonymous correlation id must be issued on first contact').toBeTruthy()
    expect(anon!.httpOnly, 'must not be readable by page scripts').toBe(true)
    expect(anon!.path).toBe('/')

    const first = await readTouch(context, FIRST)
    expect(first).toMatchObject({
      p: 'tiktok',
      s: 'tiktok',
      m: 'social',
      c: 'launch_a',
      ct: 'slide-3',
      t: 'dynasty',
      ci: 'camp_100',
      rc: 'CIEGE',
      lp: '/',
    })

    const firstCookie = await readCookie(context, FIRST)
    expect(firstCookie!.httpOnly).toBe(true)
    // Lax is required: the OAuth callback is a cross-site top-level navigation and
    // Strict would withhold these cookies exactly when the journey must be joined.
    expect(firstCookie!.sameSite).toBe('Lax')
  })

  test('preserves first touch while latest touch advances to a second campaign', async ({ page, context }) => {
    await page.goto(TIKTOK)
    const firstBefore = await readTouch(context, FIRST)
    const anonBefore = (await readCookie(context, ANON))!.value
    expect(firstBefore?.c).toBe('launch_a')

    await page.goto(INSTAGRAM)

    const firstAfter = await readTouch(context, FIRST)
    const latestAfter = await readTouch(context, LATEST)

    // The campaign that originally earned this visitor must survive later campaigns.
    expect(firstAfter?.p, 'first touch must not be overwritten').toBe('tiktok')
    expect(firstAfter?.c).toBe('launch_a')
    expect(latestAfter?.p, 'latest touch must advance').toBe('instagram')
    expect(latestAfter?.c).toBe('retarget_b')

    // Re-issuing the anon id would sever the journey from everything already recorded.
    expect((await readCookie(context, ANON))!.value).toBe(anonBefore)
  })

  test('normalizes twitter to the canonical x platform', async ({ page, context }) => {
    await page.goto(X_CAMPAIGN)
    expect((await readTouch(context, FIRST))?.p).toBe('x')
  })

  test('direct navigation does not erase a valid first touch', async ({ page, context }) => {
    await page.goto(TIKTOK)
    const before = await readTouch(context, FIRST)

    await page.goto('/')
    await page.goto('/?tab=leagues')

    const after = await readTouch(context, FIRST)
    expect(after?.c, 'plain internal navigation must not clear attribution').toBe(before?.c)
    expect(after?.p).toBe('tiktok')
  })

  test('a visitor with no campaign gets an anon id but no fabricated campaign', async ({ page, context }) => {
    await page.goto('/')

    expect(await readCookie(context, ANON), 'still correlatable').toBeTruthy()
    // Recording a "direct" campaign here would make organic traffic indistinguishable
    // from a real tracked link in campaign reporting.
    expect(await readCookie(context, FIRST)).toBeUndefined()
    expect(await readCookie(context, LATEST)).toBeUndefined()
  })

  test('does not persist unknown or sensitive query parameters', async ({ page, context }) => {
    await page.goto(
      '/?utm_source=tiktok&utm_campaign=launch_a&email=victim%40example.com&password=hunter2&token=secret-abc&session_id=xyz',
    )

    const raw = (await readCookie(context, FIRST))!.value
    const decoded = decodeURIComponent(raw)

    expect(decoded).not.toContain('victim@example.com')
    expect(decoded).not.toContain('hunter2')
    expect(decoded).not.toContain('secret-abc')
    expect(decoded).not.toContain('xyz')

    // Only the governed allowlist survives.
    const touch = await readTouch(context, FIRST)
    expect(Object.keys(touch ?? {}).sort()).toEqual(['at', 'c', 'lp', 'p', 's'])
  })

  test('bounds oversized values instead of writing an unbounded cookie', async ({ page, context }) => {
    await page.goto(`/?utm_source=tiktok&utm_campaign=${'x'.repeat(4000)}`)

    const touch = await readTouch(context, FIRST)
    expect(touch?.c?.length).toBe(120)

    const cookie = await readCookie(context, FIRST)
    expect(cookie!.value.length, 'must stay well under the 4KB cookie limit').toBeLessThan(2048)
  })

  test('survives a redirect rather than being dropped by it', async ({ page, context }) => {
    // Tracked links routinely land on a redirecting path. Capturing only on
    // non-redirect responses would silently lose those campaigns.
    const response = await page.goto('/?utm_source=youtube&utm_campaign=short_d')
    expect(response, 'page must load').toBeTruthy()

    const touch = await readTouch(context, FIRST)
    expect(touch?.p).toBe('youtube')
    expect(touch?.c).toBe('short_d')
  })

  test('a real browser landing on a tracked link records exactly one landing view', async ({ page, context }) => {
    // The full Phase 1B entry point: tracked link → middleware attribution → client beacon
    // → server-validated landing_viewed. Asserted through the browser so React StrictMode,
    // the mount effect, and the real cookie jar are all exercised together.
    await page.goto('/?utm_source=tiktok&utm_campaign=browser_journey&utm_content=slide-9')

    // The beacon is fired from an effect; wait for the request rather than racing it.
    const first = await page.evaluate(async () => {
      const res = await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'acquisition.landing_viewed', meta: { landing_path: '/' } }),
      })
      return res.json()
    })

    // Either the mounted beacon already claimed the window, or this call did. Both are a
    // single counted view — which is the property under test.
    const dedupeCookie = (await context.cookies()).find((c) => c.name === 'af_lv_seen')
    expect(dedupeCookie, 'a landing view must have been counted and the window opened').toBeTruthy()
    expect(dedupeCookie!.httpOnly).toBe(true)

    const second = await page.evaluate(async () => {
      const res = await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'acquisition.landing_viewed', meta: { landing_path: '/' } }),
      })
      return res.json()
    })

    // Whatever happened on the first call, a subsequent one inside the window is suppressed.
    expect(second).toMatchObject({ ok: true, dropped: true })
    expect(first).toBeTruthy()
  })

  test('a reload inside the dedup window does not count a second landing view', async ({ page, context }) => {
    await page.goto('/?utm_source=instagram&utm_campaign=reload_case')
    await page.evaluate(() =>
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'acquisition.landing_viewed', meta: { landing_path: '/' } }),
      }),
    )

    await page.reload()

    const afterReload = await page.evaluate(async () => {
      const res = await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'acquisition.landing_viewed', meta: { landing_path: '/' } }),
      })
      return res.json()
    })

    expect(afterReload).toMatchObject({ ok: true, dropped: true })
    // First touch must still be the campaign that earned the visitor, not the reload.
    expect((await readTouch(context, FIRST))?.c).toBe('reload_case')
  })

  test('a corrupt cookie does not break routing and is replaced cleanly', async ({ page, context }) => {
    await context.addCookies([
      { name: LATEST, value: '%7Bnot-json', domain: '127.0.0.1', path: '/' },
      { name: ANON, value: 'anon-preexisting', domain: '127.0.0.1', path: '/' },
    ])

    const response = await page.goto(TIKTOK)
    expect(response!.status(), 'a malformed cookie must not take down the route').toBeLessThan(400)

    expect((await readTouch(context, LATEST))?.p).toBe('tiktok')
    expect((await readCookie(context, ANON))!.value).toBe('anon-preexisting')
  })
})
