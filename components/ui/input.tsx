import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex min-h-[44px] h-11 w-full rounded-xl border border-subtle bg-surface-muted px-4 py-3 text-base text-primary outline-none transition-all placeholder:text-muted focus:border-brand-primary/60 focus:ring-2 focus:ring-focus/25 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
