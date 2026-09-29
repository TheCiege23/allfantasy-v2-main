import '@/components/core-app/af-core-lock.css'

import type { ReactNode } from 'react'
import { formatPaywallDay, type CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

/*
 * The two faces of the /core depth paywall (lib/core-app/coreDepthAccess.ts).
 *
 *   <CoreDepthGate access={…} what="Trade windows"> …depth… </CoreDepthGate>
 *
 * renders the children when the viewer may see them, and the lock card otherwise. Before
 * launch it also marks the children "Free until Oct 15" for a viewer without the plan — the
 * people who will lose it get told, plan holders do not.
 *
 * ⚠ THE LOCK IS NOT THE GATE. The server loader must not have loaded the locked data in the
 * first place; this only decides what the screen draws. A screen that hides data it was sent
 * is a client-only gate, which is what the 2026-09-24 audit found everywhere.
 */

function LockIcon() {
  return (
    <svg className="af-core-lock-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/*
 * ⚠ TWO WORDINGS, ONE PER PLATFORM (globals.css: data-hide-in-ios-app / data-only-in-ios-app).
 * On the web the lock names the plan and invites an upgrade. Inside the iOS app nothing is sold
 * (App Store 3.1.1), and "Upgrade to see the rest" beside a hidden button is still a call to buy
 * somewhere else — steering, which 3.1.3 forbids. So the app says only what is true there: this
 * part is not included with the account. An account that already has the plan never sees a lock.
 */
export function CoreDepthLock({ access, what }: { access: CoreDepthAccess; what?: string }) {
  const subject = what ?? access.label
  const verb = subject.endsWith('s') ? 'are' : 'is'
  return (
    <section className="af-core-lock" data-testid={`core-lock-${access.depth}`} aria-label={`${subject} — ${access.planName}`}>
      <p className="af-core-lock-head">
        <LockIcon />
        <span data-hide-in-ios-app>
          {subject} {verb} part of {access.planName}
        </span>
        <span data-only-in-ios-app>
          {subject} {verb} not included with your account
        </span>
      </p>
      <p className="af-core-lock-body">
        <span data-hide-in-ios-app>Your leagues, scores and the basics stay free. Upgrade to see the rest.</span>
        <span data-only-in-ios-app>Your leagues, scores and the basics are all here.</span>
      </p>
      {/* The /upgrade href is hidden in the app by the link rule already; marked too, in case the
          plan's path ever stops starting with /upgrade. */}
      <a className="af-core-lock-cta" href={access.upgradePath} data-hide-in-ios-app>
        See {access.planName}
      </a>
    </section>
  )
}

export function FreeUntilNote({ access }: { access: CoreDepthAccess }) {
  if (!access.preLaunchFree) return null
  const day = formatPaywallDay(access.startsAt)
  return (
    // Hidden in the iOS app: "then AF Pro" announces a plan the app cannot sell (3.1.3) — the
    // same reason the Oct 15 launch card (LaunchOfferStrip) is hidden there.
    <span className="af-core-free-until" data-testid={`core-free-until-${access.depth}`} data-hide-in-ios-app>
      Free until {day} — then {access.planName}
    </span>
  )
}

export function CoreDepthGate({
  access,
  what,
  children,
  showFreeUntil = true,
}: {
  access: CoreDepthAccess | null | undefined
  what?: string
  children: ReactNode
  /** Set false where several gated blocks sit together and one note is enough. */
  showFreeUntil?: boolean
}) {
  // No access object means the loader ran without the paywall (tests, a surface not wired
  // yet): render as before rather than lock something by accident.
  if (!access) return <>{children}</>
  if (!access.unlocked) return <CoreDepthLock access={access} what={what} />
  return (
    <>
      {showFreeUntil ? <FreeUntilNote access={access} /> : null}
      {children}
    </>
  )
}
