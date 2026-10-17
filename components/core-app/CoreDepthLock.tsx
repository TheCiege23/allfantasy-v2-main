import '@/components/core-app/af-core-lock.css'

import type { ReactNode } from 'react'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { coreDepthLockCopy, depthLabelText } from '@/lib/core-app/coreDepthLockCopy'

/*
 * The two faces of the /core depth paywall (lib/core-app/coreDepthAccess.ts).
 *
 *   <CoreDepthGate access={…} what="Trade windows"> …depth… </CoreDepthGate>
 *
 * renders the children when the viewer may see them, and the lock card otherwise. Before
 * launch it also marks the children "Free until Oct 15" for a viewer without the plan — the
 * people who will lose it get told, plan holders do not.
 *
 * Spanish (2026-10-06): the words come from lib/core-app/coreDepthLockCopy.ts in the language the
 * caller passes as `lang` — a prop, not the client provider, because CommissionerHub draws the lock
 * from a server component that resolves the language itself. The caller hands `what` over in the same
 * language (`lockSubjectText`); no `lang` reads English, byte for byte as before. Only the WORDS
 * follow the language: the gate, the depth, the plan and the upgrade link do not read it.
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
 * ⚠ TWO WORDINGS (globals.css: data-ios-purchase / data-ios-purchase-alt).
 * On the web, and in an iOS build that sells through Apple, the lock names the plan and invites an
 * upgrade. In an iOS build without the StoreKit bridge nothing is sold (App Store 3.1.1), and
 * "Upgrade to see the rest" beside a hidden button is still a call to buy somewhere else —
 * steering, which 3.1.3 forbids. So that build says only what is true there: this part is not
 * included with the account. An account that already has the plan never sees a lock.
 */
export function CoreDepthLock({ access, what, lang }: { access: CoreDepthAccess; what?: string; lang?: string }) {
  const c = coreDepthLockCopy(lang)
  const subject = what ?? depthLabelText(access.depth, access.label, lang)
  return (
    <section className="af-core-lock" data-testid={`core-lock-${access.depth}`} aria-label={`${subject} — ${access.planName}`}>
      <p className="af-core-lock-head">
        <LockIcon />
        <span data-ios-purchase>{c.head(subject, access.planName)}</span>
        <span data-ios-purchase-alt>{c.headAlt(subject)}</span>
      </p>
      <p className="af-core-lock-body">
        <span data-ios-purchase>{c.body}</span>
        <span data-ios-purchase-alt>{c.bodyAlt}</span>
      </p>
      {/* The /upgrade href is hidden in a non-IAP app build by the link rule already; marked too,
          in case the plan's path ever stops starting with /upgrade. */}
      <a className="af-core-lock-cta" href={access.upgradePath} data-ios-purchase>
        {c.cta(access.planName)}
      </a>
    </section>
  )
}

export function FreeUntilNote({ access, lang }: { access: CoreDepthAccess; lang?: string }) {
  if (!access.preLaunchFree) return null
  return (
    // Hidden in an iOS build that sells nothing: "then AF Pro" announces a plan it cannot sell
    // (3.1.3). An IAP build sells AF Pro through Apple, so it shows the note.
    <span className="af-core-free-until" data-testid={`core-free-until-${access.depth}`} data-ios-purchase>
      {coreDepthLockCopy(lang).freeUntil(access.startsAt, access.planName)}
    </span>
  )
}

export function CoreDepthGate({
  access,
  what,
  lang,
  children,
  showFreeUntil = true,
}: {
  access: CoreDepthAccess | null | undefined
  what?: string
  /** The reader's language, for the lock's and the note's words only. */
  lang?: string
  children: ReactNode
  /** Set false where several gated blocks sit together and one note is enough. */
  showFreeUntil?: boolean
}) {
  // No access object means the loader ran without the paywall (tests, a surface not wired
  // yet): render as before rather than lock something by accident.
  if (!access) return <>{children}</>
  if (!access.unlocked) return <CoreDepthLock access={access} what={what} lang={lang} />
  return (
    <>
      {showFreeUntil ? <FreeUntilNote access={access} lang={lang} /> : null}
      {children}
    </>
  )
}
