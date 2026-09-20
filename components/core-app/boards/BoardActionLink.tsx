'use client'

import { useRouter } from 'next/navigation'
import { useTransition, type ReactNode } from 'react'

/**
 * A board card's primary action, with a pending state.
 *
 * ── 🛑 THE BUG THIS EXISTS FOR: "IT DOESN'T LET YOU CLICK OPEN TRADES" ───────
 *
 * Reported from a phone as the Trades board's button doing nothing when tapped.
 * It was not dead. It was navigating, and nothing on screen said so for several
 * seconds — which is indistinguishable from dead, and worse, because the reader
 * taps again.
 *
 * ⚠ AND `loading.tsx` DOES NOT COVER THIS NAVIGATION, WHICH IS THE PART THAT
 * MAKES IT SPECIFIC RATHER THAN GENERAL SLOWNESS. `app/core/[[...screen]]/loading.tsx`
 * exists precisely to stop this route "looking dead", and its own header says so
 * — it even names /core/trades at p90 7.0s. But a Suspense fallback fires when
 * React re-suspends on a changed SEGMENT KEY, and these buttons navigate
 *
 *     /core/trades   →   /core/trades?league=<id>
 *
 * which is the SAME segment with a different search param. The segment key does
 * not change, so the boundary never re-suspends, the skeleton never paints, and
 * the one protection this route has against a slow render is structurally unable
 * to fire on the single most common navigation inside a board.
 *
 * The render behind it is genuinely long: `getTradesData` calls
 * `getSleeperTradeHistory`, a LIVE request to Sleeper, before the page returns a
 * byte. Nothing here makes that faster — this makes the wait visible, which is
 * the half the reader was missing.
 *
 * ⚠ `useTransition` + `router.push`, NOT A `<Link>` WITH AN `onClick` FLAG.
 * React keeps `isPending` true until the new RSC payload has arrived and
 * committed, so the state clears on its own and cannot be left stuck on by a
 * navigation that fails or is cancelled. A hand-rolled `setBusy(true)` has no
 * event to clear itself on and would strand the button in "Opening…" forever
 * the first time a fetch errored.
 *
 * ⚠ IT STAYS A REAL <a href>. Middle-click, ⌘-click and "open in new tab" are
 * how people work through a board of ten leagues, and a <button> loses all
 * three. `onClick` bails on any modifier or non-primary button and lets the
 * browser do what it was going to do.
 */
export function BoardActionLink({
  href,
  className,
  children,
  pendingLabel = 'Opening…',
}: {
  href: string
  className?: string
  children: ReactNode
  /** What the control says while the next screen is being built. */
  pendingLabel?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <a
      href={href}
      className={className}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      onClick={(event) => {
        /*
         * Every case the browser should keep: a new tab, a new window, a
         * download, a middle-click. `event.button !== 0` also covers the
         * middle-click that fires a click event in some browsers.
         */
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return
        }
        event.preventDefault()
        startTransition(() => router.push(href))
      }}
    >
      {pending ? pendingLabel : children}
    </a>
  )
}

export default BoardActionLink
