import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE PUSH PIPELINE WAS COMPLETE AND DELIVERED TO NOBODY.
 *
 * Every server-side piece was built and scheduled: `sendPushToUser` is called from
 * NotificationDispatcher, outboxRelay, tradeNotifyService and the alert-sweep cron; both
 * crons are in cron-schedule.json; `public/sw.js` has working push and notificationclick
 * handlers and is registered by SafeGlobalChrome. It ran correctly and delivered into an
 * EMPTY subscription table, because the one component that calls
 * `Notification.requestPermission()` was rendered in exactly one place — /settings →
 * Notifications — which on a phone sits behind a horizontally scrolling rail.
 *
 * A unit test cannot prove a phone got a notification. What it CAN pin is the thing that
 * was actually wrong: whether the ask is reachable, and whether there is still exactly one
 * of it. Both are structural, so they are checked structurally.
 */

const REPO = process.cwd()
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')

/**
 * Remove comments so the scan below reads CODE, not prose.
 *
 * ⚠ THIS TEST REPORTED ITSELF AS A VIOLATION THREE TIMES BEFORE IT WAS RIGHT, and each
 * failure was a different comment style: a JSDoc block in the game-day banner explaining
 * why it deliberately does NOT call this, the note left in LeftChatPanel recording the
 * call that was removed, and a `{/* … *\/}` JSX comment in the notifications screen.
 * Prefix heuristics (`//`, `*`) caught the first two and missed the third, because JSX
 * comment bodies are plain indented text. Tracking block state is the only version that
 * holds for all three.
 *
 * Known approximation: a `//` inside a string literal (a URL) truncates that line. That
 * can only cause a FALSE NEGATIVE, never a false positive, and no call site here follows a
 * URL on the same line.
 */
function stripComments(src: string): string {
  const out: string[] = []
  let inBlock = false
  for (const raw of src.split('\n')) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) continue
      line = line.slice(end + 2)
      inBlock = false
    }
    for (;;) {
      const start = line.indexOf('/*')
      if (start === -1) break
      const end = line.indexOf('*/', start + 2)
      if (end === -1) {
        line = line.slice(0, start)
        inBlock = true
        break
      }
      line = line.slice(0, start) + line.slice(end + 2)
    }
    const lineComment = line.indexOf('//')
    if (lineComment !== -1) line = line.slice(0, lineComment)
    out.push(line)
  }
  return out.join('\n')
}

const CORE_NOTIFICATIONS = 'components/core-app/screens/NotificationsCenter.tsx'
const IMPORT_DONE = 'components/core-app/import/ImportDone.tsx'
const SETTINGS_NOTIFICATIONS = 'app/settings/components/sections/NotificationsSettingsSection.tsx'

describe('the opt-in is reachable from the surfaces phones actually use', () => {
  it.each([
    ['core notifications screen', CORE_NOTIFICATIONS],
    ['import completion screen', IMPORT_DONE],
    ['settings (the original, must not regress)', SETTINGS_NOTIFICATIONS],
  ])('%s renders EnableWebPushCard', (_label, file) => {
    const src = read(file)
    expect(src).toContain('EnableWebPushCard')
    expect(src).toMatch(/<EnableWebPushCard\s*\/>/)
  })

  /*
   * ⚠ THE GATE IS THE WHOLE BUG. /core linked to the settings page only from a footer
   * rendered when `data.push.suppressedReason` was truthy, so a user with nothing
   * suppressed — the common case — had no route to enabling alerts at all. The card must
   * appear ABOVE that conditional, unconditionally.
   */
  it('does not hide the core ask behind suppressedReason', () => {
    /*
     * ⚠ MATCH THE CONDITIONAL, NOT THE WORD. The first draft compared the card's index
     * against `indexOf('suppressedReason')` and failed — because the earliest occurrence
     * in the file is the COMMENT above the card saying it is deliberately not gated on it.
     * The test was measuring its own explanation. Anchor on the actual JSX conditional.
     */
    const src = read(CORE_NOTIFICATIONS)
    const card = src.indexOf('<EnableWebPushCard')
    const gate = src.indexOf('data.push.suppressedReason ?')
    expect(card).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(-1)
    expect(card).toBeLessThan(gate)
  })
})

describe('there is exactly one permission flow', () => {
  /*
   * ⚠ A SECOND ASK IS A SECOND SET OF BUGS. `useWebPushSubscription` owns the iOS
   * home-screen precondition, the sticky-denied message, the bounded service-worker wait,
   * the server round trip and the rollback when that fails. A second component calling
   * `requestPermission()` reimplements all of it, and the first copy to drift does so
   * silently. Two components answering the same question differently is exactly how the
   * avatar upload ended up with two doors and one of them locked.
   */
  it('only the shared hook calls Notification.requestPermission', () => {
    const hook = read('lib/push-notifications/useWebPushSubscription.ts')
    expect(hook).toContain('Notification.requestPermission')

    const callers: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
          walk(rel)
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          /*
           * ⚠ SCAN CODE LINES, NOT PROSE — THIS TEST FLAGGED ITSELF TWICE BEFORE IT WAS
           * RIGHT. A plain substring search matched (a) the game-day banner, whose doc
           * comment explains why it deliberately does NOT call this, and (b) the comment
           * left in LeftChatPanel recording the removed call. Both are documentation of
           * the invariant being reported as violations of it.
           *
           * Comment lines are dropped by prefix, which is approximate but sufficient here:
           * every comment in this repo is either a `//` line or a block whose continuation
           * lines start with `*`. `Notification.` also excludes unrelated APIs sharing the
           * method name, such as geolocation.
           */
          if (stripComments(read(rel)).includes('Notification.requestPermission')) {
            callers.push(rel)
          }
        }
      }
    }
    walk('components')
    walk('app')
    walk('lib')

    // The hook is the only legitimate caller. Anything else here is a second flow.
    expect(callers).toEqual(['lib/push-notifications/useWebPushSubscription.ts'])
  })

  it('the game-day banner signposts the ask instead of duplicating it', () => {
    const src = read('components/notifications/GameDayAlertsBanner.tsx')
    expect(src).not.toContain('Notification.requestPermission')
    expect(src).toContain('/core/notifications')
  })

  it('the banner is mounted in the core shell, so every screen inherits it', () => {
    const shell = read('components/core-app/AfCoreShell.tsx')
    expect(shell).toMatch(/<GameDayAlertsBanner\s*\/>/)
  })
})

describe('the dead second service worker stays dead', () => {
  /*
   * ⚠ BOTH OF THESE WERE LIVE FOOTGUNS, NOT MERELY UNUSED. `hooks/usePushSubscription.ts`
   * registered `/sw-push.js` at scope '/', which would have fought `/sw.js` for the same
   * scope — and it sat under an obvious name that the next person wiring up push would
   * have found first. Deleted after a four-form census (alias, relative, dynamic import,
   * test mock) returned zero importers.
   */
  it.each(['public/sw-push.js', 'hooks/usePushSubscription.ts'])('%s is gone', (p) => {
    expect(existsSync(join(REPO, p))).toBe(false)
  })

  it('nothing registers a service worker other than /sw.js', () => {
    const chrome = read('components/shell/SafeGlobalChrome.tsx')
    expect(chrome).toContain('serviceWorker.register("/sw.js"')
    expect(chrome).not.toContain('sw-push')
  })
})

describe('the iPhone dead end', () => {
  /*
   * 🛑 iOS DOES NOT EXPOSE `PushManager` IN A NORMAL SAFARI TAB — only in a site added to
   * the Home Screen. So `readPermission()` returns 'unsupported' for every iPhone user who
   * has not installed the app, the `if (!supported)` early return fired, and they were
   * told "this browser doesn't support web push notifications". It does. They were two
   * taps away.
   *
   * ⚠ AND THE INSTRUCTION THAT FIXES IT WAS PHYSICALLY UNREACHABLE. The "add to Home
   * Screen" hint lives AFTER that early return, so the one surface explaining the fix
   * never rendered for the only people who needed it. Reported by a user who found no
   * Enable button and no reason given.
   *
   * Asserted on ordering because that is what the bug was: both branches existed, in the
   * wrong sequence.
   */
  it('checks needsHomeScreen BEFORE declaring the browser unsupported', () => {
    const src = read('components/notifications/EnableWebPushCard.tsx')
    const unsupportedGuard = src.indexOf('if (!supported)')
    const homeScreenBranch = src.indexOf('needsHomeScreen', unsupportedGuard)
    const deadEndCopy = src.indexOf("doesn&apos;t support web push")
    expect(unsupportedGuard).toBeGreaterThan(-1)
    expect(homeScreenBranch).toBeGreaterThan(-1)
    // The iOS branch must come between the guard and the generic dead-end message.
    expect(homeScreenBranch).toBeLessThan(deadEndCopy)
  })

  it('tells a blocked user how to clear it, not just that it is blocked', () => {
    // A denial is sticky and cannot be re-asked from script, so this copy is the only exit.
    const src = read('components/notifications/EnableWebPushCard.tsx')
    const denied = src.slice(src.indexOf("permission === 'denied'"))
    expect(denied).toMatch(/Allow|Permissions|Settings/)
  })
})

describe('the install prompt is capturable where signed-in users are', () => {
  /*
   * 🛑 `initPWA` ATTACHES THE `beforeinstallprompt` LISTENER, AND ITS ONLY CALLER WAS
   * MOUNTED ON AUTH ROUTES. `ServiceWorkerRegistration` is rendered solely by
   * `AuthRouteGlobalChrome` (/login, /signup). The browser fires that event once, early, so
   * a signed-in user on /core never had it captured: `canInstallApp()` was permanently
   * false and every install affordance degraded to a manual instructions alert. Same shape
   * as the push opt-in — built, correct, mounted where it could not work.
   */
  it('SafeGlobalChrome initialises PWA install capture on non-auth routes', () => {
    const src = read('components/shell/SafeGlobalChrome.tsx')
    expect(src).toContain('initPWA')
    expect(src).toMatch(/initPWA\(\)/)
  })

  it('the core notifications screen offers the install action', () => {
    // On iPhone, installing is a PREREQUISITE for notifications, not a parallel feature.
    const src = read(CORE_NOTIFICATIONS)
    expect(src).toContain('InstallButton')
    expect(src).toMatch(/<InstallButton\s+hideWhenInstalled\s*\/>/)
  })
})

describe('the sender still emits both click-target keys', () => {
  /*
   * ⚠ DELETING sw-push.js DOES NOT MAKE THE DUAL EMISSION REDUNDANT, WHICH IS THE EASY
   * WRONG CONCLUSION. A deploy does not update the service worker already installed on a
   * user's device, so whatever key that copy reads it has to find. Emitting only `href`
   * once sent every notification to the /app fallback instead of its target.
   */
  it('sendToSubscription serializes href and url', () => {
    const src = read('lib/push-notifications/push-service.ts')
    // `href` rides as an ES shorthand property; `url` is explicitly aliased to the same value.
    expect(src).toMatch(/\n\s*href,\s*\n/)
    expect(src).toMatch(/url:\s*href/)
  })
})
