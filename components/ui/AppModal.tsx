"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog"

/**
 * SHARED MODAL CONTRACT (Phase 1) — one overlay primitive for league settings, trades, waivers,
 * War Room, commissioner tools, and future Chimmy panels.
 *
 * Built on Radix Dialog so it gets, for free and consistently:
 *  - Escape closes, backdrop click closes (via onOpenChange)
 *  - focus trapping + focus return to the trigger
 *  - body scroll-lock while open (react-remove-scroll)
 *  - portal rendering (escapes parent overflow/stacking contexts)
 *
 * On top, it standardizes the layout that bespoke modals kept getting wrong:
 *  - bounded height (`max-h-[90dvh]`) with a header / scrollable body / footer column
 *  - the scrollable body uses `min-h-0 flex-1 overflow-y-auto` (the missing `min-h-0` is the
 *    classic flexbox bug that broke internal scrolling in the old settings/trade modals)
 */

export type AppModalSize = "sm" | "md" | "lg" | "xl" | "full"

const SIZE_CLASS: Record<AppModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[96vw]",
}

export interface AppModalProps {
  open: boolean
  onClose: () => void
  /** Accessible title (rendered in the header unless `hideHeader`). */
  title?: React.ReactNode
  description?: React.ReactNode
  size?: AppModalSize
  /** Header-right slot (e.g. a toggle); the close (X) button is always rendered. */
  headerAccessory?: React.ReactNode
  /** Footer slot pinned below the scroll area. */
  footer?: React.ReactNode
  /** Hide the default header row (caller renders its own). A visually-hidden title is still set. */
  hideHeader?: boolean
  /** Disable closing on backdrop click / Escape (e.g. mid-submit). */
  dismissible?: boolean
  className?: string
  /** Extra classes for the scrollable body. */
  bodyClassName?: string
  children: React.ReactNode
  "data-testid"?: string
}

export function AppModal({
  open,
  onClose,
  title,
  description,
  size = "md",
  headerAccessory,
  footer,
  hideHeader = false,
  dismissible = true,
  className,
  bodyClassName,
  children,
  ...rest
}: AppModalProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissible) onClose()
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          data-testid={rest["data-testid"]}
          onEscapeKeyDown={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          className={cn(
            "fixed left-1/2 top-1/2 z-[90] flex max-h-[90dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-subtle bg-surface text-primary shadow-popover outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            SIZE_CLASS[size],
            className,
          )}
        >
          {/* Title is always present for a11y; visually hidden when hideHeader. */}
          {hideHeader ? (
            <DialogPrimitive.Title className="sr-only">{title ?? "Dialog"}</DialogPrimitive.Title>
          ) : (
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-subtle px-5 py-4">
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate text-[17px] font-semibold text-primary">
                  {title}
                </DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="mt-0.5 text-xs text-muted">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {headerAccessory}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  data-testid="app-modal-close"
                  className="rounded-lg p-1.5 text-muted transition hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
          )}

          {/* Scrollable body — `min-h-0` is required for the flex child to scroll instead of grow. */}
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)} data-testid="app-modal-body">
            {children}
          </div>

          {footer ? <div className="shrink-0 border-t border-subtle px-5 py-3">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  )
}

export default AppModal
