"use client"

import { useSyncExternalStore } from "react"
import { isNewVersionReady, subscribeNewVersionReady } from "@/lib/core-app/deployGuard"

/**
 * The reader's side of `lib/core-app/deployGuard`.
 *
 * When a deploy lands while a page is open, background refreshes stop (each one would
 * have been a full reload under the reader) and this pill appears instead. The page
 * keeps working on the build it loaded; the reader reloads when THEY choose to.
 */
export function NewVersionPill() {
  const ready = useSyncExternalStore(subscribeNewVersionReady, isNewVersionReady, () => false)
  if (!ready) return null
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        transform: "translateX(-50%)",
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: "calc(100vw - 32px)",
        padding: "8px 8px 8px 16px",
        borderRadius: 999,
        background: "rgba(15, 23, 42, 0.96)",
        color: "#e2e8f0",
        border: "1px solid rgba(148, 163, 184, 0.25)",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        fontSize: 14,
        lineHeight: 1.2,
      }}
    >
      {/* `left: 50%` leaves the pill only half the viewport to size itself in; without
          nowrap a phone wraps this onto three lines. */}
      <span style={{ whiteSpace: "nowrap" }}>New version ready</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          border: 0,
          borderRadius: 999,
          padding: "8px 14px",
          minHeight: 36,
          background: "#06b6d4",
          color: "#03121a",
          fontWeight: 700,
          fontSize: 14,
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
    </div>
  )
}

export default NewVersionPill
