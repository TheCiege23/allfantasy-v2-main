import { render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FormattedTimestamp } from "@/components/commissioner-os/FormattedTimestamp"

/**
 * Guards the fix for React error #422: `toLocaleString` with no locale or
 * time zone formatted the snapshot timestamp on the server and again in the
 * browser, the two strings differed, and hydration of the Suspense boundary
 * failed for any reader whose locale or zone differs from the server's.
 */
describe("commissioner-os FormattedTimestamp", () => {
  const iso = '2026-09-07T12:34:56.000Z'

  it("emits no formatted string on the server, so it cannot differ from the client", () => {
    const html = renderToString(<FormattedTimestamp iso={iso} />)
    expect(html).not.toContain(new Date(iso).toLocaleString())
    expect(html).toBe('<span></span>')
  })

  it("formats the timestamp with the browser locale after mount", () => {
    render(<FormattedTimestamp iso={iso} />)
    expect(screen.getByText(new Date(iso).toLocaleString())).toBeInTheDocument()
  })
})
