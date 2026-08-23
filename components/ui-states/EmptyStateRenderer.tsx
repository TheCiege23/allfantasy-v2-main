"use client"

import Link from "next/link"
import { Inbox } from "lucide-react"

/**
 * Handoff 16c — the "empty" third of the shared state vocabulary.
 *
 * ⚠ THESE PRIMITIVES ARE DELIBERATELY STYLED WITH TAILWIND UTILITIES AND NOT WITH
 * THE `.af-core` TOKEN LAYER. Every other screen in the 16-series handoff family
 * paints from af-core.css, but that palette is scoped to a `.af-core` ancestor on
 * purpose so a handoff cannot repaint the rest of the product. These three
 * renderers are dropped into ten surfaces that have no such ancestor — settings,
 * notifications, the search overlay, the profile page, two route-level loading.tsx
 * files — so every var() would resolve to nothing and the components would render
 * unstyled in most of the places they are used. Utilities work everywhere they
 * land, which is the whole point of a shared primitive.
 *
 * ⚠ TEXT COLOURS ARE ARBITRARY-VALUE CLASSES LIKE `text-[#eef0fa]`, NEVER
 * `text-white/55`, AND THAT IS NOT A STYLE PREFERENCE. app/globals.css carries
 * `html[data-mode="light"] .mode-readable [class*="text-white"] { color:
 * var(--text) !important }`, which rescues dark-authored surfaces when the app is
 * in light mode by assuming the surface went light too. Every current host of
 * these primitives is dark in BOTH modes — settings sits on #161826, the
 * notification panel and search overlay likewise — so the clamp repainted this
 * text to near-black on a dark card. Measured on the preview route before this
 * change: a contrast ratio of 1.00, i.e. literally invisible. The clamp matches on
 * the substring "text-white", so an arbitrary value carrying the same colour
 * renders identically and is immune. Do not "tidy" these back into `text-white/nn`.
 *
 * ⚠ THE EXISTING PROP CONTRACT IS ADDITIVE-ONLY. `compact` is still a boolean and
 * still means what it meant; `variant` is the richer control the handoff needs.
 * Ten call sites pass the old props and none of them were touched.
 */

export interface EmptyStateAction {
  id: string
  label: string
  href?: string
  onClick?: () => void
  testId?: string
  /**
   * The handoff's full-page empty draws two CTAs with different weights — an
   * accented "Import a league" beside a neutral "Create a league". Defaults to
   * ghost so existing call sites are unchanged.
   */
  variant?: "primary" | "ghost"
}

export interface EmptyStateRendererProps {
  title: string
  description: string
  icon?: React.ReactNode
  actions?: EmptyStateAction[]
  /** Legacy switch, equivalent to variant="compact". */
  compact?: boolean
  /**
   * full    — the whole-page empty (no leagues yet): big icon tile, headline, two CTAs.
   * panel   — an empty inside a panel that still has a heading of its own.
   * compact — the small paired variant for narrow two-up grids.
   */
  variant?: "full" | "panel" | "compact"
  testId?: string
}

function actionClass(variant: EmptyStateAction["variant"], small: boolean): string {
  const size = small ? "px-3 py-1.5 text-[11px]" : "px-4 py-2.5 text-xs"
  return variant === "primary"
    ? `rounded-xl border border-cyan-400/45 bg-cyan-400/10 ${size} font-semibold text-cyan-200 transition hover:bg-cyan-400/20`
    : `rounded-xl border border-white/12 bg-white/[0.05] ${size} font-semibold text-[#c3c9e6] transition hover:bg-white/[0.1]`
}

export default function EmptyStateRenderer({
  title,
  description,
  icon,
  actions = [],
  compact = false,
  variant,
  testId,
}: EmptyStateRendererProps) {
  const resolved = variant ?? (compact ? "compact" : "panel")
  const isFull = resolved === "full"
  const isCompact = resolved === "compact"

  return (
    <div
      className={[
        "rounded-2xl border border-white/10 bg-white/[0.02] text-center",
        isFull ? "px-6 py-12" : isCompact ? "px-4 py-6" : "px-6 py-9",
      ].join(" ")}
      data-testid={testId}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        <div
          className={[
            "mb-3 inline-flex items-center justify-center rounded-xl text-cyan-300",
            isCompact
              ? "h-7 w-7 text-[#6b7295]"
              : "h-12 w-12 border border-cyan-400/25 bg-cyan-400/10",
          ].join(" ")}
          aria-hidden
        >
          {icon ?? <Inbox className={isCompact ? "h-4 w-4" : "h-5 w-5"} />}
        </div>

        <h3
          className={[
            "font-black text-[#eef0fa]",
            isFull ? "text-2xl" : isCompact ? "text-sm" : "text-lg",
          ].join(" ")}
        >
          {title}
        </h3>

        {/*
          ⚠ THE DESCRIPTION IS NOT OPTIONAL AND NOT DECORATIVE. 16c's copy rule is
          that every state says what happened and what to press next; an empty
          state with only a headline says the first half and leaves the user to
          guess the second.
        */}
        <p
          className={[
            "mt-2 whitespace-pre-line text-[#989fc2]",
            isCompact ? "text-[11px]" : "text-sm leading-relaxed",
          ].join(" ")}
        >
          {description}
        </p>

        {actions.length > 0 ? (
          <div className={["flex flex-wrap justify-center gap-2", isFull ? "mt-6" : "mt-4"].join(" ")}>
            {actions.map((action) =>
              action.href ? (
                <Link
                  key={action.id}
                  href={action.href}
                  data-testid={action.testId}
                  className={actionClass(action.variant, isCompact)}
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  data-testid={action.testId}
                  className={actionClass(action.variant, isCompact)}
                >
                  {action.label}
                </button>
              )
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The handoff's two-up row of small empties ("Nobody's said anything yet" beside
 * "No career history yet"). A grid rather than two loose cards so the pair keeps
 * equal heights when one description wraps and the other does not.
 */
export function EmptyStateGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}
