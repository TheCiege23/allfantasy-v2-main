import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] af-focus-ring",
  {
    variants: {
      variant: {
        default:
          "af-button-primary",
        destructive:
          "border bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger-soft)_72%,var(--surface-hover))]",
        outline:
          "af-button-secondary bg-transparent",
        secondary:
          "af-button-secondary",
        ghost:
          "text-[var(--text-primary)] hover:bg-[var(--surface-hover)]",
        link:
          "text-[var(--color-primary)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 py-2.5 min-h-[44px]",
        sm: "h-9 px-4 text-xs min-h-[36px]",
        lg: "h-12 px-8 py-3.5 text-base min-h-[48px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        style={{
          borderColor:
            variant === 'outline' || variant === 'secondary' || variant === 'destructive'
              ? 'var(--border-subtle)'
              : undefined,
        }}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
