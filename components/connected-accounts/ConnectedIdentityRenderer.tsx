"use client"

import { CheckCircle2 } from "lucide-react"
import type { ProviderStatus } from "@/lib/connected-accounts"

export interface ConnectedIdentityRendererProps {
  provider: ProviderStatus
  size?: "sm" | "md"
  className?: string
}

/**
 * Renders a single sign-in provider row: name, linked status, and optional action slot.
 */
export function ConnectedIdentityRenderer({
  provider,
  size = "md",
  className = "",
}: ConnectedIdentityRendererProps) {
  const textSize = size === "sm" ? "text-xs" : "text-sm"

  return (
    <div
      className={`flex items-center justify-between gap-2 ${className}`}
      data-provider={provider.id}
    >
      <span className={`font-medium ${textSize}`} style={{ color: "var(--text)" }}>
        {provider.name}
      </span>
      <div className="flex items-center gap-2">
        {!provider.configured && (
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
            Not configured
          </span>
        )}
        {provider.linked ? (
          <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--muted)" }}>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
            Linked
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            Not linked
          </span>
        )}
      </div>
    </div>
  )
}
