"use client"

import { useEffect } from "react"
import { captureException } from "@/lib/error-tracking"

/**
 * Root-level global error boundary.
 *
 * Keep this fallback provider-free. Unlike route-level error boundaries,
 * `global-error` replaces the root layout when active, so Next requires it to
 * render its own document tags. Returning a bare element here lets the browser
 * synthesize an implicit document shell, which is exactly the malformed Railway
 * HTML that cascades into HierarchyRequestError during hydration.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface in Railway logs so we can see what's actually throwing at root.
    // eslint-disable-next-line no-console
    console.error("[app/global-error] root layout boundary caught", {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack?.slice(0, 600),
    })
    captureException(error, { context: "global-error", digest: error?.digest })
  }, [error])

  const bodyStyle = {
    margin: 0,
    minHeight: "100vh",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    background: "#0b1020",
    color: "#e6e8ef",
  }

  return (
    <html
      lang="en"
      data-lang="en"
      data-mode="dark"
      className="scroll-smooth"
      suppressHydrationWarning
    >
      <body style={bodyStyle}>
        <div
          role="alert"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              maxWidth: "520px",
              width: "100%",
              background: "#141a2e",
              border: "1px solid #232b46",
              borderRadius: "16px",
              padding: "32px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#7d88a8",
                marginBottom: "8px",
              }}
            >
              AllFantasy
            </div>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                margin: "0 0 12px 0",
                lineHeight: 1.3,
              }}
            >
              Something went wrong loading this page.
            </h1>
            <p
              style={{
                fontSize: "14px",
                lineHeight: 1.55,
                color: "#aab2c8",
                margin: "0 0 20px 0",
              }}
            >
              We hit an unexpected error. You can retry, or head back to the dashboard.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  appearance: "none",
                  cursor: "pointer",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "0",
                  background: "#5eead4",
                  color: "#0b1020",
                  fontWeight: 700,
                  fontSize: "13px",
                }}
              >
                Retry
              </button>
              <a
                href="/dashboard"
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "1px solid #2d3658",
                  background: "transparent",
                  color: "#e6e8ef",
                  fontWeight: 600,
                  fontSize: "13px",
                  textDecoration: "none",
                }}
              >
                Dashboard
              </a>
              <a
                href="/"
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "1px solid #2d3658",
                  background: "transparent",
                  color: "#e6e8ef",
                  fontWeight: 600,
                  fontSize: "13px",
                  textDecoration: "none",
                }}
              >
                Home
              </a>
            </div>
            {error?.digest ? (
              <div
                style={{
                  marginTop: "20px",
                  fontSize: "11px",
                  color: "#6b7693",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                }}
              >
                ref: {error.digest}
              </div>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  )
}
