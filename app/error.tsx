"use client"

import Link from "next/link"
import { useEffect } from "react"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    try {
      // eslint-disable-next-line no-console
      console.error("[app/error] root boundary caught", {
        message: error?.message,
        digest: error?.digest,
        stack: typeof error?.stack === "string" ? error.stack.slice(0, 600) : undefined,
      })
    } catch {
      /* ignore */
    }
  }, [error])

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        background: "#020617",
        color: "#e2e8f0",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
        <p style={{ marginTop: 8, fontSize: 13, color: "rgba(226,232,240,0.7)" }}>
          We couldn&apos;t load this page. Try again, or head back to your dashboard.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "#0ea5e9",
              color: "#fff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <Link
            href="/core"
            style={{
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.18)",
              color: "rgba(226,232,240,0.9)",
              textDecoration: "none",
            }}
          >
            Dashboard
          </Link>
          <Link
            href="/"
            style={{
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.18)",
              color: "rgba(226,232,240,0.9)",
              textDecoration: "none",
            }}
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  )
}
