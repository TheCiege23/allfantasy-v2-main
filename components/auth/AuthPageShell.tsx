import type { ReactNode } from "react"

/**
 * Page chrome for /login and /signup.
 *
 * ⚠ THIS USED TO BE `bg-slate-950 text-white` AND THAT WAS WRONG IN LIGHT MODE.
 * It wraps AuthV4, which paints its own `var(--bg)` and `--hero` wash from the
 * `.af-core` token layer and responds to `html[data-mode]`. A hardcoded Tailwind
 * slate sat outside that scope and disagreed with it — measured in light mode,
 * the shell computed to `color(srgb 1 1 1 / 0.94)` because the global
 * `.mode-readable` clamp was rewriting it. It rendered acceptably by accident,
 * not by design, and `text-white` leaked into anything the card did not colour
 * explicitly.
 *
 * There is nothing left for it to paint: the child already covers the viewport
 * with `min-height: 100vh`. So this is now a transparent passthrough that keeps
 * only the `data-auth-page-shell` hook other code keys off.
 */
export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div data-auth-page-shell="true" className="min-h-screen">
      {children}
    </div>
  )
}
