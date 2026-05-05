import type { ReactNode } from "react"

export interface ShellLayoutContainerProps {
  children: ReactNode
  /** Max width class; default max-w-7xl. Use `max-w-none` to opt out (full-bleed). */
  maxWidth?: "max-w-6xl" | "max-w-7xl" | "max-w-[1400px]" | "max-w-none"
  /** Horizontal padding classes. */
  paddingClassName?: string
  /** Extra class for the inner content */
  className?: string
}

/**
 * Consistent content container for shell content area: max-width, horizontal padding.
 */
export function ShellLayoutContainer({
  children,
  maxWidth = "max-w-7xl",
  paddingClassName = "px-4 sm:px-6",
  className = "",
}: ShellLayoutContainerProps) {
  return (
    <div className={`mx-auto w-full ${maxWidth} ${paddingClassName} ${className}`.trim()}>
      {children}
    </div>
  )
}
