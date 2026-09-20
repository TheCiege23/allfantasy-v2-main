'use client'

import { useState, useEffect } from 'react'

/**
 * Back to top.
 *
 * ── 🛑 WHY THIS IS NOT `bottom-20 right-4` ANY MORE ─────────────────────────
 *
 * It was, and so were two other fixed controls that render on the same pages:
 *
 *     BackToTop          fixed bottom-20 right-4 z-50   40x40
 *     GlobalModeToggle   fixed bottom-20 right-4 z-40   44x44 (phone)
 *     .af-cm-launch      right:18 bottom:76    z-59     56x56
 *
 * Three controls, one corner, ~80px from the bottom on all three. Reported from
 * a phone as "the chat bubble and back to top button are on top of each other";
 * measured, the theme pill is under BOTH of them and is simply unreachable with
 * a thumb on /core. The highest z-index wins, so which button a page actually
 * wanted was the one underneath.
 *
 * af-core.css already solved this once, for two legacy dash34 FABs, and left the
 * geometry behind as shared tokens with the comment "anything anchored to that
 * corner positions off them and takes the next slot up, so a new button can be
 * added without discovering the collision in a screenshot". These two never
 * adopted them, because they are Tailwind components outside the af-* sheets and
 * nothing connects the two worlds. They do now — `--af-fab-slot-2` is the third
 * step up from the comms launcher, and it tracks the phone tab bar's real height
 * (home indicator included) without this file having to know any of it.
 *
 * ⚠ THE FALLBACKS ARE NOT DECORATION. This component renders on marketing and
 * auth-adjacent routes too, where af-core.css is not loaded and the custom
 * properties genuinely do not exist — a bare `var(--af-fab-slot-2)` would
 * compute to nothing and drop the button into the page's top-left corner.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      /*
       * ⚠ 44x44, NOT 40x40. It is a fixed control sitting over page content, so
       * a missed tap lands on whatever is underneath — the same argument
       * GlobalModeToggle already makes for its own phone floor.
       */
      className="fixed z-50 w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 bg-purple-600 hover:bg-purple-500 text-white border border-purple-400/30"
      style={{
        right: 'var(--af-fab-inset, 18px)',
        /*
         * The fallback is the token's own DESKTOP value, computed by hand:
         * 18 (inset) + 56 (launcher) + 12 (gap) = 86 for slot 1, + 60 + 12 = 158.
         * Keeping it exact means a route without af-core.css lays these two out
         * in the same relative positions as one with it, rather than in a second
         * arrangement nobody designed.
         */
        bottom: 'var(--af-fab-slot-2, 158px)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
  )
}
