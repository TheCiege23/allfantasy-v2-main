/**
 * Authenticated browser proof for the /core overlay stack.
 *
 * WHAT THIS EXISTS TO CATCH. Every /core overlay used to own its own copy of
 * "the page behind must not scroll", "Escape closes me" and "the background is
 * inert". Each was correct alone. The SET was not, and every failure needs two
 * overlays open at once.
 *
 *   1. The scroll lock inverted. Sheet saves `overflow: ''`, drawer then saves
 *      `'hidden'`. Close the sheet first and it restores `''` — the page scrolls
 *      behind a still-open modal drawer. Close the drawer after and it writes
 *      `'hidden'` back, locking a page with no overlay on it at all.
 *   2. One Escape closed every open overlay, because every listener fired.
 *   3. The league tray inerted every sibling of `.af-rail` — which is `.af-main`
 *      (the player card's mount point) and `CommsDock` (the drawer's). Opening
 *      the tray over an open card left that card painted, modal, and dead.
 *
 * 🛑 SO THE ASSERTIONS ARE ABOUT PAIRS, AND BOTH ORDERS OF BOTH PAIRS. A proof
 * that opened one overlay at a time would have passed against every one of those
 * bugs. Opening order and closing order are varied independently for that reason.
 *
 * ⚠ THE TWO PAIRS ARE REACHED DIFFERENTLY, AND THE DIFFERENCE IS ITSELF A RESULT.
 * With containment working, background controls are `inert`, so a second overlay
 * can NO LONGER be opened by clicking past the first one — the first run of this
 * proof failed on `<button inert="" class="af-cm-launch">`, which is the fix
 * behaving correctly. The two stacks that remain reachable are therefore:
 *
 *   - tray → "Contact support": a control INSIDE the first overlay, so the OPEN
 *     is a genuine pointer journey — the way a user actually gets here.
 *   - card + Comms: raised by `af-comms-open` on `window`, which is the product's
 *     own cross-surface opener — `MyTeam`, `LeagueHome` and `TradeCenter` all
 *     dispatch it and `CommsDock` listens unconditionally. A deep link or a
 *     notification puts the drawer over whatever is already open.
 *
 * WHY AUTHENTICATED AND NOT COMPONENT-LEVEL. The sibling relationships above are
 * properties of the real shell's DOM — `.af-rail`, `.af-main` and `CommsDock` as
 * children of `.af-core.af-shell` — and inertness is decided by walking that tree.
 * A harness that mounts the sheet on its own cannot see any of it. This runs the
 * real server, a real session and the real `/core/my-team` roster, which is only
 * possible at all because `lib/e2e/seedG8League` now writes `Roster.playerData`
 * (before that the screen rendered zero rows and had nothing to click).
 *
 * Chromium AND WebKit: `inert` and `closest('[inert]')` are the load-bearing
 * primitives here and their WebKit support is younger than their Blink support.
 *
 * SETUP — a server this script does NOT start, deliberately, so the database it
 * talks to is a decision made outside it:
 *
 *   AF_NEXT_DIST_DIR=.next-dev-mobile-batch DEV_AUTH_BYPASS_ENABLED=true \
 *   node node_modules/next/dist/bin/next dev -p 3010 -H 127.0.0.1
 *
 *   node scripts/audits/mobile-overlay-stack-proof.cjs
 *
 *   AF_PROOF_REPORT_ONLY=1     every measurement, no early exit (positive control)
 *   AF_PROOF_ENGINES=chromium  skip WebKit
 *   AF_PROOF_BASE_URL=...      default http://127.0.0.1:3010
 */
const assert = require('assert/strict')
const path = require('path')
const root = path.resolve(__dirname, '../..').split(path.sep).join('/')
const playwright = require(root + '/node_modules/playwright')

const BASE = process.env.AF_PROOF_BASE_URL || 'http://127.0.0.1:3010'
const ENGINES = (process.env.AF_PROOF_ENGINES || 'chromium,webkit').split(',').filter(Boolean)
const REPORT_ONLY = process.env.AF_PROOF_REPORT_ONLY === '1'
const PHONE = { width: 390, height: 844 }

const failures = []
const notes = []
function check(condition, message) {
  if (condition) {
    notes.push('  ok   ' + message)
    return
  }
  if (REPORT_ONLY) {
    failures.push(message)
    notes.push('  FAIL ' + message)
  } else {
    assert.fail(message)
  }
}

const SEL = {
  shell: '.af-core.af-shell',
  main: '.af-main',
  trayHandle: '.af-rail-handle',
  tray: '#af-rail',
  cardTrigger: '.af-pc-trigger',
  cardPanel: '.af-pc-panel',
  cardScrim: '.af-pc-scrim',
  cardClose: '.af-pc-x',
  commsLaunch: '.af-cm-launch',
  commsPanel: '.af-cm[data-mode="overlay"]',
  commsScrim: '.af-cm-scrim',
  commsClose: '.af-cm-close',
  supportOpen: '.af-nav-support',
  supportPanel: '.af-sp',
  supportScrim: '.af-sp-scrim',
  supportClose: '.af-sp-close',
}

/**
 * One reading of every property the bugs above corrupted.
 *
 * ⚠ `body.style.overflow` IS READ, NOT `getComputedStyle`. The lock is an inline
 * style written by the hook, and that is the thing under test; a computed value
 * would also report `hidden` for any stylesheet rule that happens to agree, which
 * is how a broken lock reads as a working one.
 */
async function snapshot(page) {
  return page.evaluate((sel) => {
    const describe = (el) => {
      if (!el) return null
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : ''
      const label = el.getAttribute && el.getAttribute('aria-label')
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (label ? `[${label}]` : '')
    }
    const card = document.querySelector(sel.cardPanel)
    const comms = document.querySelector(sel.commsPanel)
    const support = document.querySelector(sel.supportPanel)
    const tray = document.querySelector(sel.tray)
    const main = document.querySelector(sel.main)
    const handle = document.querySelector(sel.trayHandle)
    const active = document.activeElement

    const open = []
    if (card) open.push('card')
    if (comms) open.push('comms')
    if (support) open.push('support')

    const inside = (el) => (el ? !!el.closest('[inert]') : null)
    const holds = (el) => !!(el && active && el.contains(active))

    /*
     * 🛑 THE SCRIMS ARE READ SEPARATELY FROM THE PANELS, AND THAT SPLIT IS THE
     * WHOLE POINT. A scrim rendered as a SIBLING of its panel lands in the inert
     * sweep, which removes hit testing — the backdrop keeps painting, keeps
     * looking clickable, and its onClick never fires. `panelInsideInert` stays
     * false throughout, so every assertion about the PANEL passes while
     * click-outside-to-close is dead.
     */
    const scrimInert = (sel) => {
      const el = document.querySelector(sel)
      return el ? !!el.closest('[inert]') : null
    }

    return {
      overflow: document.body.style.overflow,
      cardOpen: !!card,
      commsOpen: !!comms,
      supportOpen: !!support,
      trayOpen: !!(tray && tray.getAttribute('data-open') !== 'false'),
      openDialogs: open,
      openCount: open.length,
      // The requirement, measured directly: an ACTIVE dialog must not sit inside
      // an inert subtree. `closest` walks ancestors including the element itself.
      cardInsideInert: inside(card),
      commsInsideInert: inside(comms),
      supportInsideInert: inside(support),
      mainInert: main ? main.hasAttribute('inert') : null,
      handleInert: handle ? handle.hasAttribute('inert') : null,
      cardScrimInert: scrimInert(sel.cardScrim),
      commsScrimInert: scrimInert(sel.commsScrim),
      supportScrimInert: scrimInert(sel.supportScrim),
      activeDesc: describe(active),
      activeInCard: holds(card),
      activeInComms: holds(comms),
      activeInSupport: holds(support),
      activeIsBody: active === document.body,
      inertCount: document.querySelectorAll('[inert]').length,
    }
  }, SEL)
}

/**
 * Click (or dispatch) until the overlay actually appears.
 *
 * ⚠ NOT FLAKE-PAPERING — IT IS WAITING FOR HYDRATION, AND THE DISTINCTION IS
 * MEASURABLE. Before React attaches its listeners, a click on `.af-pc-trigger`
 * still moves focus to the button and still does nothing else: the probe that
 * found this reported `active: "af-pc-trigger"` with `cardPanel: 0`, which is a
 * landed click with no handler behind it. A single click plus a generous
 * `waitForSelector` would therefore fail for a reason that has nothing to do
 * with what this proof measures, and on a dev server (webpack, first compile)
 * that window is seconds long.
 */
async function openUntilVisible(page, act, panelSel, label) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await act()
    try {
      await page.waitForSelector(panelSel, { timeout: 4000 })
      return
    } catch {
      if (attempt === 6) throw new Error(`${label} never opened after ${attempt} attempts`)
      await page.waitForTimeout(1000)
    }
  }
}

const openers = {
  /**
   * ⚠ `covered` DISPATCHES RATHER THAN POINTS, AND THE MEASURED FACT BEHIND IT
   * IS WORTH RECORDING: with the Comms drawer open there is NO pointer path to
   * the player card at all. Every `.af-pc-trigger` lives in `.af-main`, which is
   * both inert and physically underneath the drawer, and the drawer itself
   * renders no player names — `components/core-app/comms/*` imports neither
   * `PlayerName` nor `usePlayerCard`.
   *
   * So `comms → card` is not a journey a user can perform today. It is exercised
   * anyway, driven the way code would drive it, because the stack ordering it
   * tests is a property of the hook rather than of this particular pair — and the
   * moment any surface inside the drawer renders a player name (a trade card, a
   * quoted message) the order becomes reachable with no change to the hook.
   */
  async card(page, opts) {
    const trigger = page.locator(SEL.cardTrigger).first()
    const covered = !!(opts && opts.covered)
    await openUntilVisible(
      page,
      () => (covered ? trigger.dispatchEvent('click') : trigger.click()),
      SEL.cardPanel,
      'player card',
    )
  },
  /**
   * Clicked when nothing else is open, so the bubble itself stays exercised;
   * dispatched when something IS open, because the bubble is then correctly
   * inert. See the header note.
   */
  /**
   * ⚠ `covered` IS PASSED BY THE CALLER, NOT SNIFFED FROM `[inert]`, AND THE
   * POSITIVE CONTROL IS WHY. The first version decided by asking whether the
   * launcher was inert — which is true only AFTER the fix. Run against the
   * pre-fix code the answer was "not inert", so it attempted a real click, the
   * open sheet intercepted it, and the control aborted on a Playwright timeout
   * before reaching a single lock assertion. A harness that behaves differently
   * on the two sides of the change cannot compare them.
   */
  async comms(page, opts) {
    const covered = !!(opts && opts.covered)
    await openUntilVisible(
      page,
      async () => {
        if (covered) {
          await page.evaluate(() =>
            window.dispatchEvent(new CustomEvent('af-comms-open', { detail: { tab: 'chimmy' } })),
          )
        } else {
          await page.locator(SEL.commsLaunch).click()
        }
      },
      SEL.commsPanel,
      'comms drawer',
    )
  },
}

/**
 * Close an overlay by its own close button.
 *
 * ⚠ `covered: true` DISPATCHES THE CLICK INSTEAD OF AIMING A POINTER, AND THE
 * REASON IS GEOMETRY, NOT CONVENIENCE. When two overlays are stacked, the lower
 * one's close button is literally underneath the upper one's panel — Playwright
 * correctly refuses the click with "…af-cm-close from <aside class="af-cm"> …
 * intercepts pointer events". A real user cannot click it either.
 *
 * That does not make the case hypothetical. The property under test is the
 * ORDER TWO REACT CLEANUPS RUN IN, and a lower overlay closes underneath a
 * higher one whenever its own state changes for a reason that is not a click —
 * `PlayerCardProvider.close()` from a route change, a parent re-render, a
 * `seq` bump from a second card being requested. Dispatching the click drives
 * exactly that path: the component's `onClose` runs, React unmounts it, and the
 * hook's cleanup fires out of LIFO order. Which is the case that inverted the
 * scroll lock.
 *
 * ⚠ AND THERE IS NO POINTER-DRIVEN NON-LIFO CLOSE ANYWHERE, WHICH IS A RESULT
 * RATHER THAN A GAP. This comment first claimed the tray's external handle
 * provided one, because `keepInteractiveRefs` keeps it live. It does not: the
 * handle is only exempt from the inert sweep while the TRAY is topmost, so once
 * the support modal is above it the handle is inert like everything else. That
 * is the containment working. Every non-LIFO close here is therefore dispatched,
 * and it stands in for a state change rather than a click.
 */
function makeCloser(panelSel, closeSel) {
  return async (page, opts) => {
    if (opts && opts.covered) {
      await page.locator(closeSel).dispatchEvent('click')
    } else {
      await page.locator(closeSel).click()
    }
    await page.waitForSelector(panelSel, { state: 'detached', timeout: 15000 })
  }
}

const closers = {
  card: makeCloser(SEL.cardPanel, SEL.cardClose),
  comms: makeCloser(SEL.commsPanel, SEL.commsClose),
  support: makeCloser(SEL.supportPanel, SEL.supportClose),
}

const insideInertKey = { card: 'cardInsideInert', comms: 'commsInsideInert', support: 'supportInsideInert' }
const activeInKey = { card: 'activeInCard', comms: 'activeInComms', support: 'activeInSupport' }

async function signIn(context) {
  const csrfRes = await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 120000 })
  if (!csrfRes.ok()) throw new Error(`csrf failed: ${csrfRes.status()}`)
  const { csrfToken } = await csrfRes.json()
  const res = await context.request.post(`${BASE}/api/auth/callback/dev-bypass`, {
    form: { csrfToken, callbackUrl: `${BASE}/core`, json: 'true' },
    timeout: 120000,
  })
  if (!res.ok()) throw new Error(`dev-bypass sign-in failed: ${res.status()}`)
  const cookies = await context.cookies()
  if (!cookies.some((c) => c.name.includes('next-auth.session-token'))) {
    throw new Error('dev-bypass sign-in produced no session cookie')
  }
}

async function seedLeague(context) {
  /*
   * ⚠ THREE MINUTES, NOT THE 30s DEFAULT. This is a dev server, so the first
   * request to the route pays a webpack compile, and the seed itself runs a
   * canonical-create transaction with its own 25s budget. The default timeout
   * aborts mid-transaction and reports it as a fixture failure.
   */
  const res = await context.request.post(`${BASE}/api/e2e/decision-os-proof-league`, {
    headers: { 'x-allfantasy-e2e': '1', 'content-type': 'application/json' },
    data: { team: 'KC', season: 2097, week: 1 },
    timeout: 180000,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok()) throw new Error(`seed failed ${res.status()}: ${JSON.stringify(body).slice(0, 400)}`)
  return body
}

async function cleanupLeague(context, seeded) {
  if (!seeded || !seeded.leagueId) return 'nothing to clean'
  const res = await context.request.delete(`${BASE}/api/e2e/decision-os-proof-league`, {
    headers: { 'x-allfantasy-e2e': '1', 'content-type': 'application/json' },
    // The POST response handed back verbatim — see the route's own note.
    data: seeded,
    timeout: 120000,
  })
  return res.status()
}

// ── Scenarios ────────────────────────────────────────────────────────────

/**
 * A stacked pair, parameterised by opening order and by which one closes first.
 *
 * The LIFO close is the case every hand-rolled implementation already handled.
 * The other one is what inverted the lock, and it is reachable with a mouse:
 * both dialogs have their own close button and their own backdrop.
 */
async function scenarioPair(page, engine, first, second, closeFirst) {
  const label = `${engine} ${first}→${second} close:${closeFirst}`
  const closeSecond = closeFirst === first ? second : first

  await openers[first](page)
  // The second overlay opens over the first, so its own opener is covered.
  await openers[second](page, { covered: true })

  const both = await snapshot(page)
  check(both.openCount === 2, `${label}: both overlays open (saw ${both.openDialogs.join(',') || 'none'})`)
  check(both.overflow === 'hidden', `${label}: page locked with two overlays open (overflow="${both.overflow}")`)
  /*
   * ⚠ ONLY THE TOPMOST DIALOG IS LIVE, AND THE ONE BENEATH IT IS *SUPPOSED* TO BE
   * INERT. This assertion was written the other way round first — "each open
   * dialog is outside any inert subtree" — and it failed, correctly.
   *
   * The requirement is that an ACTIVE dialog is never inert, and with a stack the
   * active dialog is the top one; a modal layer below it is background, exactly
   * like the page. The regression this batch fixes was not "a dialog was inert",
   * it was that the TOP dialog was inert — the tray inerted `.af-main` and
   * `CommsDock` wholesale, so the thing the user had just opened was dead while
   * nothing else was reachable either. What matters is that the live layer is
   * always the top one, and that closing it makes the next one live again — which
   * is asserted after each close below.
   */
  check(
    both[insideInertKey[second]] === false,
    `${label}: the TOPMOST ${second} is live (not inside an inert subtree)`,
  )
  check(
    both[insideInertKey[first]] === true,
    `${label}: the covered ${first} is inert beneath it (correct layering)`,
  )
  check(both[activeInKey[second]], `${label}: focus is in the newly-opened ${second} (active=${both.activeDesc})`)

  /*
   * ⚠ BOTH CLOSES ARE DISPATCHED, NOT POINTED, AND UNIFORMLY SO. Deciding per
   * overlay which one is "covered" bakes in a paint order — and the paint order
   * is not the same before and after this change: on the pre-fix code the sheet
   * renders ABOVE the drawer, so the control run aborted with `.af-pc-x … from
   * .af-main intercepts pointer events` while trying to click the drawer's close
   * button. A control that cannot finish measures nothing.
   *
   * What this scenario tests is the ORDER TWO REACT CLEANUPS RUN IN, which is
   * independent of who is painted on top. The pointer-driven closes are covered
   * for real elsewhere: `scenarioBackdrop` (a real mouse click on the scrim),
   * `scenarioEscapePeels` (real key presses) and `scenarioTraySupport` (a real
   * click on the tray's own controls).
   */
  await closers[closeFirst](page, { covered: true })
  const one = await snapshot(page)
  check(one.openCount === 1, `${label}: exactly one overlay remains after closing ${closeFirst}`)
  check(
    one.overflow === 'hidden',
    `${label}: page STILL locked with ${closeSecond} open (overflow="${one.overflow}") — the inverted-lock regression`,
  )
  check(one[insideInertKey[closeSecond]] === false, `${label}: remaining ${closeSecond} is not inside an inert subtree`)

  await closers[closeSecond](page, { covered: true })
  const none = await snapshot(page)
  check(none.openCount === 0, `${label}: no overlay left open`)
  check(
    none.overflow !== 'hidden',
    `${label}: page UNLOCKED once the last overlay closed (overflow="${none.overflow}") — the stuck-lock regression`,
  )
  check(none.inertCount === 0, `${label}: no [inert] left anywhere (saw ${none.inertCount})`)
}

/**
 * The tray, and the support modal opened from a control INSIDE it.
 *
 * 🛑 THIS IS THE PAIR THAT NAMES THE TRAY REGRESSION. The tray used to inert
 * every sibling of `.af-rail`, and `CommsDock` — which mounts `SupportModal` —
 * is one of them. So the tray inerted the very dialog its own button opens.
 */
async function scenarioTraySupport(page, engine, closeFirst) {
  const label = `${engine} tray→support close:${closeFirst}`
  const handle = page.locator(SEL.trayHandle)
  if ((await handle.count()) === 0) {
    notes.push(`  skip ${label}: no phone tray handle at this width`)
    return
  }

  await handle.click()
  await page.waitForTimeout(300)
  const trayUp = await snapshot(page)
  check(trayUp.overflow === 'hidden', `${label}: page locked with the tray open`)
  check(trayUp.mainInert === true, `${label}: .af-main IS inert while the tray is topmost`)

  await openSupport(page)
  /*
   * ⚠ THE SUPPORT MODAL HAD NO BACKDROP COVERAGE ANYWHERE. `scenarioBackdrop`
   * never opens it — it is only reachable from inside the tray — so its scrim
   * went un-asserted entirely and was inert in exactly the same way the drawer's
   * was. Checked here, where it is already open.
   */
  await checkScrimLive(page, engine, 'support')
  const both = await snapshot(page)
  check(both.supportOpen, `${label}: support modal opened from inside the tray`)
  check(
    both.supportInsideInert === false,
    `${label}: the support modal is NOT inside an inert subtree — the tray-inerts-CommsDock regression`,
  )
  check(both.overflow === 'hidden', `${label}: page locked with tray + support open`)

  if (closeFirst === 'support') {
    await closers.support(page)
    const one = await snapshot(page)
    check(one.overflow === 'hidden', `${label}: page STILL locked with the tray open (overflow="${one.overflow}")`)
    check(one.mainInert === true, `${label}: .af-main is inert again once the tray is topmost`)
    await closeTray(page)
  } else {
    // The tray is UNDERNEATH the modal, so its handle is inert — see closeTray.
    await closeTray(page, { covered: true })
    const one = await snapshot(page)
    check(one.supportOpen, `${label}: the support modal survived the tray closing beneath it`)
    check(
      one.overflow === 'hidden',
      `${label}: page STILL locked with the support modal open (overflow="${one.overflow}")`,
    )
    check(one.supportInsideInert === false, `${label}: support modal still live after the tray closed beneath it`)
    await closers.support(page)
  }

  const none = await snapshot(page)
  check(none.openCount === 0 && !none.supportOpen, `${label}: nothing left open`)
  check(none.overflow !== 'hidden', `${label}: unlocked once both closed (overflow="${none.overflow}")`)
  check(none.inertCount === 0, `${label}: no [inert] left anywhere (saw ${none.inertCount})`)
}

async function openSupport(page) {
  await openUntilVisible(
    page,
    async () => {
      const blocked = await page.evaluate((sel) => {
        const btn = document.querySelector(sel.supportOpen)
        return !btn || !!btn.closest('[inert]')
      }, SEL)
      if (blocked) {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('af-support-open')))
      } else {
        await page.locator(SEL.supportOpen).click()
      }
    },
    SEL.supportPanel,
    'support modal',
  )
}

/**
 * The tray's close control is its external handle — the `keepInteractiveRefs` case.
 *
 * ⚠ `covered` MUST DISPATCH, AND THE FIRST VERSION OF THIS FUNCTION FELL BACK TO
 * ESCAPE INSTEAD, WHICH IS WHY IT LIED. With the support modal on top, the handle
 * is correctly inert — `keepInteractiveRefs` keeps it live only while the TRAY is
 * topmost — so the pointer path is gone and Escape goes to the topmost overlay.
 * The fallback therefore closed the SUPPORT MODAL while claiming to close the
 * tray, and the next assertion read a modal that was already gone as "inert".
 * A fallback that silently does something else is worse than no fallback.
 */
async function closeTray(page, opts) {
  if (opts && opts.covered) {
    await page.locator(SEL.trayHandle).dispatchEvent('click')
  } else {
    await page.locator(SEL.trayHandle).click()
  }
  await page.waitForTimeout(400)
}

/** One Escape closes exactly one overlay, topmost first. */
async function scenarioEscapePeels(page, engine) {
  const label = `${engine} escape`
  await openers.card(page)
  await openers.comms(page, { covered: true })

  check((await snapshot(page)).openCount === 2, `${label}: two overlays open before Escape`)

  await page.keyboard.press('Escape')
  await page.waitForSelector(SEL.commsPanel, { state: 'detached', timeout: 15000 })
  const afterOne = await snapshot(page)
  check(
    afterOne.openCount === 1 && afterOne.cardOpen,
    `${label}: ONE Escape closed only the topmost overlay, leaving the card (saw ${afterOne.openDialogs.join(',') || 'none'})`,
  )
  check(afterOne.overflow === 'hidden', `${label}: still locked after peeling one layer`)
  check(
    afterOne.activeInCard,
    `${label}: focus moved into the revealed card, not to the opener (active=${afterOne.activeDesc})`,
  )

  await page.keyboard.press('Escape')
  await page.waitForSelector(SEL.cardPanel, { state: 'detached', timeout: 15000 })
  const afterTwo = await snapshot(page)
  check(afterTwo.openCount === 0, `${label}: second Escape closed the last overlay`)
  check(afterTwo.overflow !== 'hidden', `${label}: unlocked after the last Escape`)
}

/** Focus returns to the control that opened the overlay, and never to <body>. */
async function scenarioFocusRestore(page, engine) {
  const label = `${engine} focus-restore`
  const trigger = page.locator(SEL.cardTrigger).first()
  await trigger.focus()
  const openerBefore = await page.evaluate(
    () => document.activeElement && document.activeElement.textContent.trim().slice(0, 40),
  )
  await trigger.click()
  await page.waitForSelector(SEL.cardPanel, { timeout: 15000 })

  const open = await snapshot(page)
  check(open.activeInCard, `${label}: focus landed inside the card on open (active=${open.activeDesc})`)

  await page.keyboard.press('Escape')
  await page.waitForSelector(SEL.cardPanel, { state: 'detached', timeout: 15000 })
  const closed = await snapshot(page)
  check(!closed.activeIsBody, `${label}: focus did NOT fall to <body> on close (active=${closed.activeDesc})`)
  const openerAfter = await page.evaluate(
    () => document.activeElement && document.activeElement.textContent.trim().slice(0, 40),
  )
  check(
    openerAfter === openerBefore,
    `${label}: focus returned to the opening control ("${openerAfter}" vs "${openerBefore}")`,
  )
}

/**
 * An opener that is gone by the time the overlay closes.
 *
 * The row is removed from the DOM while the sheet is open, so restoration has a
 * detached node to aim at. Focusing a detached node silently lands on <body>,
 * which is the failure being excluded.
 */
async function scenarioOpenerUnmounted(page, engine) {
  const label = `${engine} opener-unmounted`
  await openers.card(page)
  await page.evaluate((sel) => {
    const trigger = document.querySelector(sel.cardTrigger)
    const row = trigger && trigger.closest('li, tr, .af-mt-row')
    if (row && row.parentElement) row.parentElement.removeChild(row)
    else if (trigger && trigger.parentElement) trigger.parentElement.removeChild(trigger)
  }, SEL)

  await page.keyboard.press('Escape')
  await page.waitForSelector(SEL.cardPanel, { state: 'detached', timeout: 15000 })
  const after = await snapshot(page)
  check(after.openCount === 0, `${label}: the sheet closed`)
  check(
    after.overflow !== 'hidden',
    `${label}: the lock was released even though the opener had unmounted (overflow="${after.overflow}")`,
  )
  check(after.inertCount === 0, `${label}: no [inert] left behind by an unmounted opener`)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector(SEL.cardTrigger, { timeout: 60000 })
}

/** Tab stays inside the TOPMOST overlay and cannot reach the page behind. */
async function scenarioTabContainment(page, engine) {
  const label = `${engine} tab-containment`
  await openers.card(page)
  await openers.comms(page, { covered: true })

  let escaped = null
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press('Tab')
    const where = await page.evaluate((sel) => {
      const comms = document.querySelector(sel.commsPanel)
      const active = document.activeElement
      if (!comms) return 'gone'
      if (!active) return 'none'
      if (comms.contains(active)) return 'inside'
      if (active === document.body) return 'body'
      return 'outside'
    }, SEL)
    if (where !== 'inside') {
      escaped = `${where} after ${i + 1} Tab presses`
      break
    }
  }
  check(escaped === null, `${label}: 25 Tab presses stayed inside the topmost overlay (escaped: ${escaped})`)

  await page.keyboard.press('Escape')
  await page.waitForSelector(SEL.commsPanel, { state: 'detached', timeout: 15000 })
  await page.keyboard.press('Escape')
  await page.waitForSelector(SEL.cardPanel, { state: 'detached', timeout: 15000 })
}

/** Clicking the backdrop closes that overlay, and releases exactly its own lock. */
/**
 * ⚠ THE CLICK POINT IS MEASURED, NOT ASSUMED. The player card's scrim WRAPS its
 * panel and closes on `e.target === e.currentTarget`, so a click that lands on
 * the panel does nothing — and a fixed corner like (5,5) is on the panel at some
 * widths and on the scrim at others. Hunting for a point that is inside the scrim
 * and outside the panel is what makes this assertion mean "the backdrop closes
 * it" rather than "the corner I picked happened to be backdrop today".
 *
 * If no such point exists the sheet covers the whole viewport, backdrop-close is
 * genuinely unreachable at that width, and that is reported rather than failed.
 */
async function backdropPoint(page, scrimSel, panelSel) {
  return page.evaluate(
    ([scrimSel, panelSel]) => {
      const scrim = document.querySelector(scrimSel)
      const panel = document.querySelector(panelSel)
      if (!scrim) return null
      const s = scrim.getBoundingClientRect()
      const p = panel ? panel.getBoundingClientRect() : null
      const candidates = [
        [s.left + 6, s.top + 6],
        [s.right - 6, s.top + 6],
        [s.left + 6, s.bottom - 6],
        [s.left + s.width / 2, s.top + 6],
      ]
      for (const [x, y] of candidates) {
        if (p && x >= p.left && x <= p.right && y >= p.top && y <= p.bottom) continue
        if (document.elementFromPoint(x, y) !== scrim) continue
        return { x, y }
      }
      return null
    },
    [scrimSel, panelSel],
  )
}

/**
 * 🛑 THE SCRIM MUST BE LIVE, ASSERTED INDEPENDENTLY OF GEOMETRY.
 *
 * This exists because the geometry check below CANNOT FAIL when the overlay is
 * full-bleed: `backdropPoint` returns null, the run emits a note, and the
 * assertion is simply skipped. That is exactly how a regression shipped — the
 * hook's inert sweep marked `.af-cm-scrim` and `.af-sp-scrim` (both SIBLINGS of
 * their panels), backdrop-close died on both, and the proof reported "the comms
 * drawer covers its scrim — no backdrop to click at this width", which reads
 * like a layout fact rather than a dead control.
 *
 * `inert` is a property of the element, not of the viewport, so this holds at
 * every width and there is no shape of the page that turns it into a note.
 */
async function checkScrimLive(page, engine, which) {
  const key = { card: 'cardScrimInert', comms: 'commsScrimInert', support: 'supportScrimInert' }[which]
  const seen = await snapshot(page)
  check(seen[key] === false, `${engine} scrim: the ${which} backdrop is NOT inert (saw ${seen[key]})`)
}

async function scenarioBackdrop(page, engine) {
  const label = `${engine} backdrop`

  await openers.card(page)
  await checkScrimLive(page, engine, 'card')
  const cardPt = await backdropPoint(page, SEL.cardScrim, SEL.cardPanel)
  if (!cardPt) {
    notes.push(`  note ${label}: the card sheet covers the full viewport — no backdrop to click at this width`)
    await page.keyboard.press('Escape')
    await page.waitForSelector(SEL.cardPanel, { state: 'detached', timeout: 15000 })
  } else {
    await page.mouse.click(cardPt.x, cardPt.y)
    await page.waitForSelector(SEL.cardPanel, { state: 'detached', timeout: 15000 })
    const afterCard = await snapshot(page)
    check(afterCard.openCount === 0, `${label}: card closed on a click at (${Math.round(cardPt.x)},${Math.round(cardPt.y)})`)
    check(afterCard.overflow !== 'hidden', `${label}: unlocked after card backdrop close`)
  }

  await openers.comms(page)
  await checkScrimLive(page, engine, 'comms')
  const commsPt = await backdropPoint(page, SEL.commsScrim, SEL.commsPanel)
  if (!commsPt) {
    notes.push(`  note ${label}: the comms drawer covers its scrim — no backdrop to click at this width`)
    await page.keyboard.press('Escape')
    await page.waitForSelector(SEL.commsPanel, { state: 'detached', timeout: 15000 })
  } else {
    await page.mouse.click(commsPt.x, commsPt.y)
    await page.waitForSelector(SEL.commsPanel, { state: 'detached', timeout: 15000 })
    const afterComms = await snapshot(page)
    check(afterComms.openCount === 0, `${label}: comms closed on a click at (${Math.round(commsPt.x)},${Math.round(commsPt.y)})`)
    check(afterComms.overflow !== 'hidden', `${label}: unlocked after comms backdrop close`)
  }

  const end = await snapshot(page)
  check(end.inertCount === 0, `${label}: no [inert] left after backdrop closes (saw ${end.inertCount})`)
  check(end.overflow !== 'hidden', `${label}: page unlocked at the end of the backdrop scenario`)
}

/**
 * A route change while an overlay is open must not leave the lock or the inert
 * marks behind — the unmount path, not the close-button path.
 */
async function scenarioRouteChange(page, engine, leagueId) {
  const label = `${engine} route-change`
  await openers.card(page)
  check((await snapshot(page)).overflow === 'hidden', `${label}: locked before navigating`)

  await page.goto(`${BASE}/core?league=${leagueId}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector(SEL.shell, { timeout: 90000 })
  await page.waitForTimeout(600)

  const after = await snapshot(page)
  check(after.openCount === 0, `${label}: no overlay survived the navigation`)
  check(
    after.overflow !== 'hidden',
    `${label}: the scroll lock did NOT survive the navigation (overflow="${after.overflow}")`,
  )
  check(after.inertCount === 0, `${label}: no stale [inert] after navigation (saw ${after.inertCount})`)

  /*
   * ⚠ THE WINDOW IS NOT NECESSARILY THE SCROLLER, AND ASSUMING IT WAS PRODUCED A
   * FALSE FAILURE. This shell scrolls an inner column, so `window.scrollTo` moved
   * nothing on a page that was perfectly scrollable and the check reported the
   * lock as still on — with `body.style.overflow` measured as `""` three lines
   * above, which is the contradiction that gave it away. So the real scroller is
   * found first, and the lock is confirmed released on the element that owns it.
   */
  const scrollProof = await page.evaluate(() => {
    const candidates = [document.scrollingElement, document.body, ...document.querySelectorAll('.af-main, main')]
    for (const el of candidates) {
      if (!el) continue
      if (el.scrollHeight <= el.clientHeight + 1) continue
      /*
       * ⚠ `scroll-behavior: smooth` MAKES scrollTop ANIMATED, SO READING IT BACK
       * IMMEDIATELY RETURNS THE OLD VALUE. This repo's <html> carries
       * `scroll-smooth`, and the first version of this check reported a perfectly
       * scrollable page as locked for exactly that reason. Forced to `auto` for
       * the measurement, then put back.
       */
      const priorBehavior = el.style.scrollBehavior
      el.style.scrollBehavior = 'auto'
      const before = el.scrollTop
      el.scrollTop = before + 120
      const moved = el.scrollTop !== before
      el.scrollTop = before
      el.style.scrollBehavior = priorBehavior
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/)[0] : el.tagName.toLowerCase()
      return { found: true, moved, who: cls || el.tagName.toLowerCase() }
    }
    return { found: false, moved: null, who: null }
  })
  if (!scrollProof.found) {
    notes.push(`  note ${label}: nothing on this page is taller than its viewport — scrolling not exercised`)
  } else {
    check(
      scrollProof.moved,
      `${label}: the page scrolls again after navigating away from an open overlay (scroller: ${scrollProof.who})`,
    )
  }
  check(
    (await page.evaluate(() => getComputedStyle(document.body).overflow)) !== 'hidden',
    `${label}: body's COMPUTED overflow is not hidden either`,
  )
}

// ── Runner ───────────────────────────────────────────────────────────────

async function runEngine(engineName) {
  const browserType = playwright[engineName]
  if (!browserType) throw new Error(`unknown engine: ${engineName}`)
  const browser = await browserType.launch()
  const context = await browser.newContext({ viewport: PHONE })
  /*
   * The global age-confirmation dialog is a first-visit gate mounted outside the
   * /core shell. Dismissed through its OWN sessionStorage key rather than by
   * POSTing /api/auth/confirm-age, so the proof writes nothing to the database
   * that its own cleanup does not remove.
   */
  await context.addInitScript(() => {
    try {
      sessionStorage.setItem('af_age_prompt_dismissed', '1')
    } catch {
      /* private mode — the prompt reappears and the run reports it */
    }
  })

  let seeded = null
  try {
    await signIn(context)
    seeded = await seedLeague(context)
    notes.push(`  seeded league ${seeded.leagueId} (${(seeded.seededPlayerIds || []).length} fixture players)`)

    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    await page.goto(`${BASE}/core/my-team?league=${seeded.leagueId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    })
    await page.waitForSelector(SEL.shell, { timeout: 120000 })
    await page.waitForSelector(SEL.cardTrigger, { timeout: 120000 })

    const rows = await page.locator(SEL.cardTrigger).count()
    check(rows > 0, `${engineName}: the populated fixture rendered a clickable roster (${rows} player triggers)`)

    // Both opening orders × both closing orders.
    await scenarioPair(page, engineName, 'card', 'comms', 'comms')
    await scenarioPair(page, engineName, 'card', 'comms', 'card')
    await scenarioPair(page, engineName, 'comms', 'card', 'card')
    await scenarioPair(page, engineName, 'comms', 'card', 'comms')

    await scenarioTraySupport(page, engineName, 'support')
    await scenarioTraySupport(page, engineName, 'tray')

    await scenarioEscapePeels(page, engineName)
    await scenarioFocusRestore(page, engineName)
    await scenarioOpenerUnmounted(page, engineName)
    await scenarioTabContainment(page, engineName)
    await scenarioBackdrop(page, engineName)

    /*
     * ⚠ AND AGAIN WIDER, BECAUSE AT 390px THERE IS NO BACKDROP TO CLICK. Both
     * overlays are full-bleed on a phone — measured, see the notes that scenario
     * emits — so the backdrop path simply does not exist there and asserting it
     * would be asserting nothing. 900px still renders the drawer as an overlay
     * (docked needs 1200px), so the same code path is exercised with a scrim the
     * pointer can actually reach.
     */
    await page.setViewportSize({ width: 900, height: 800 })
    await page.waitForTimeout(400)
    await scenarioBackdrop(page, `${engineName}@900`)
    await page.setViewportSize(PHONE)
    await page.waitForTimeout(400)

    await scenarioRouteChange(page, engineName, seeded.leagueId)

    /*
     * ⚠ ONE NARROW EXEMPTION, NAMED RATHER THAN SWALLOWED. WebKit rejects Next's
     * RSC prefetch (`?_rsc=…`) on this dev origin as a cross-origin fetch. It is
     * router prefetching, it happens on navigation whether or not an overlay was
     * ever opened, and nothing in this batch touches routing — but an unqualified
     * `pageErrors.length === 0` would go red on it and a blanket try/catch would
     * hide the next real error too. Matching on BOTH `_rsc=` and the access-control
     * wording keeps the exemption to this one framework behaviour.
     */
    const isRscPrefetchNoise = (e) => e.includes('_rsc=') && e.includes('access control checks')
    const realErrors = pageErrors.filter((e) => !isRscPrefetchNoise(e))
    const ignored = pageErrors.length - realErrors.length
    if (ignored > 0) {
      notes.push(`  note ${engineName}: ignored ${ignored} Next RSC-prefetch fetch rejection(s) — see the exemption note`)
    }
    check(realErrors.length === 0, `${engineName}: no uncaught page errors (${realErrors.slice(0, 2).join(' | ')})`)
  } finally {
    let status
    try {
      status = await cleanupLeague(context, seeded)
    } catch (e) {
      status = `cleanup threw: ${e.message}`
    }
    notes.push(`  cleanup DELETE -> ${status}`)
    await browser.close()
  }
}

async function main() {
  console.log(`Overlay stack proof — ${BASE} @ ${PHONE.width}x${PHONE.height}`)
  for (const engine of ENGINES) {
    const before = notes.length
    console.log(`\n[${engine}]`)
    try {
      await runEngine(engine.trim())
    } finally {
      /*
       * ⚠ PRINTED IN `finally`. A throw part-way through used to discard every
       * measurement taken before it, so a run that failed on the ninth scenario
       * reported nothing about the eight that had passed — which is the single
       * least useful thing a proof can do when it goes red.
       */
      console.log(notes.slice(before).join('\n'))
    }
  }
  if (failures.length) {
    console.error(`\n${failures.length} FAILURES:`)
    for (const f of failures) console.error('  - ' + f)
    process.exit(1)
  }
  console.log(`\nAll checks passed across: ${ENGINES.join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
