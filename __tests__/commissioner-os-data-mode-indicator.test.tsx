/**
 * Gate Opening Plan, Option C — DataModeIndicator stays hidden from
 * ordinary production users, but the site-admin allowlist (isSiteAdmin(),
 * resolved server-side in app/commissioner-os/layout.tsx and passed down
 * as isAdmin) can still see and use it, to verify live mode end-to-end
 * without exposing the switcher to real customers.
 */
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataModeIndicator } from "@/components/commissioner-os/demo-mode/DataModeIndicator"

beforeEach(() => {
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("DataModeIndicator — production visibility gate", () => {
  it("renders nothing for a non-admin caller in production (existing behavior, unchanged)", () => {
    vi.stubEnv("NODE_ENV", "production")
    const { container } = render(<DataModeIndicator />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing for a non-admin caller in production, even when isAdmin is explicitly false", () => {
    vi.stubEnv("NODE_ENV", "production")
    const { container } = render(<DataModeIndicator isAdmin={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders the switcher for the allowlisted admin caller in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    render(<DataModeIndicator isAdmin />)
    expect(screen.getByLabelText("Data mode")).toBeInTheDocument()
  })

  it("still renders in development regardless of isAdmin (unchanged dev/QA behavior)", () => {
    vi.stubEnv("NODE_ENV", "development")
    const { container: nonAdmin } = render(<DataModeIndicator isAdmin={false} />)
    expect(nonAdmin).not.toBeEmptyDOMElement()
  })
})
