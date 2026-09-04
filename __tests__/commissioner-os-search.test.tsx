import { fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CommissionerSearchPalette } from "@/components/commissioner-os/search/CommissionerSearchPalette"
import { CommissionerPlatformProvider, useCommissionerPlatform } from "@/components/commissioner-os/providers/CommissionerPlatformProvider"
import { stubSearchClient } from "@/lib/commissioner-ui/search/decision-os-client/stub"
import { demoSearchClient } from "@/lib/commissioner-ui/search/decision-os-client/demo"
import { liveSearchClient } from "@/lib/commissioner-ui/search/decision-os-client/live"
import { COMMISSIONER_ALL_NAV_ITEMS } from "@/lib/commissioner-ui/navigation/moduleNav"
import type { CommissionerSearchResultContract } from "@/lib/commissioner-ui/contracts"

const pushMock = vi.hoisted(() => vi.fn())

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

function OpenSearchButton() {
  const { openService } = useCommissionerPlatform()
  return (
    <button type="button" onClick={() => openService('search')}>
      Open Search (test)
    </button>
  )
}

function Harness({ index, errorMessage }: { index: CommissionerSearchResultContract[]; errorMessage?: string | null }) {
  return (
    <CommissionerPlatformProvider>
      <OpenSearchButton />
      <CommissionerSearchPalette index={index} errorMessage={errorMessage} />
    </CommissionerPlatformProvider>
  )
}

const RESULT_A: CommissionerSearchResultContract = {
  id: 'recommendation-a', category: 'recommendation', title: 'Manager engagement declining', href: '/commissioner-os/recommendations', sourceModuleId: 'league-health',
}
const RESULT_B: CommissionerSearchResultContract = {
  id: 'manager-b', category: 'manager', title: 'Priya Natarajan', href: '/commissioner-os/managers', sourceModuleId: 'managers',
}

describe("commissioner-os search — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    for (const client of [stubSearchClient, demoSearchClient, liveSearchClient]) {
      expect(typeof client.getIndex).toBe('function')
    }
  })

  it("stub and demo are source-tagged and error-free; live is an honest, typed placeholder error", async () => {
    const stubResponse = await stubSearchClient.getIndex()
    const demoResponse = await demoSearchClient.getIndex()
    expect(stubResponse.source).toBe('stub')
    expect(stubResponse.error).toBeNull()
    expect(demoResponse.source).toBe('demo')
    expect(demoResponse.error).toBeNull()

    const liveResponse = await liveSearchClient.getIndex()
    expect(liveResponse.data).toBeNull()
    expect(liveResponse.error?.category).toBe('upstream_unavailable')
    expect(liveResponse.error?.retryable).toBe(false)
    expect(liveResponse.source).toBe('live')
  })

  it("demo index covers every non-page category with at least one result, plus every indexed nav page", async () => {
    const response = await demoSearchClient.getIndex()
    const categories = new Set(response.data!.map((r) => r.category))
    for (const category of ['recommendation', 'manager', 'task', 'report', 'automation', 'setting', 'help', 'page'] as const) {
      expect(categories.has(category)).toBe(true)
    }
    const pageResults = response.data!.filter((r) => r.category === 'page')
    expect(pageResults).toHaveLength(COMMISSIONER_ALL_NAV_ITEMS.length)
  })

  it("help articles are indexed by title with an href back to the Help Center page, never a copy of the article body", async () => {
    const response = await demoSearchClient.getIndex()
    const helpResults = response.data!.filter((r) => r.category === 'help')
    expect(helpResults.length).toBeGreaterThan(0)
    for (const result of helpResults) {
      expect(result.href).toBe('/commissioner-os/help')
      expect(result.sourceModuleId).toBe('help')
    }
  })

  it("no search result carries anything beyond the platform contract's five fields — never a duplicated copy of the underlying entity", async () => {
    const response = await demoSearchClient.getIndex()
    for (const result of response.data!) {
      expect(Object.keys(result).sort()).toEqual(['category', 'href', 'id', 'sourceModuleId', 'title'])
      expect(result.href.startsWith('/commissioner-os')).toBe(true)
      expect(result.title.length).toBeGreaterThan(0)
    }
  })
})

describe("commissioner-os search — command palette", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("renders no dialog until the search platform service is opened", () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("opens with results grouped by category when the header entry point fires openService('search')", async () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    fireEvent.click(screen.getByText('Open Search (test)'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Recommendations')).toBeInTheDocument()
    expect(within(dialog).getByText('Managers')).toBeInTheDocument()
    expect(within(dialog).getByText(RESULT_A.title)).toBeInTheDocument()
    expect(within(dialog).getByText(RESULT_B.title)).toBeInTheDocument()
  })

  it("typing narrows results via cmdk's own filtering", async () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    fireEvent.click(screen.getByText('Open Search (test)'))
    const dialog = await screen.findByRole('dialog')

    const input = within(dialog).getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Priya' } })

    expect(within(dialog).getByText(RESULT_B.title)).toBeInTheDocument()
    expect(within(dialog).queryByText(RESULT_A.title)).not.toBeInTheDocument()
  })

  it("shows the empty state for a query matching nothing", async () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    fireEvent.click(screen.getByText('Open Search (test)'))
    const dialog = await screen.findByRole('dialog')

    const input = within(dialog).getByRole('combobox')
    fireEvent.change(input, { target: { value: 'zzz-no-match-zzz' } })

    expect(within(dialog).getByText('No results found.')).toBeInTheDocument()
  })

  it("selecting a result navigates to its href and closes the palette", async () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    fireEvent.click(screen.getByText('Open Search (test)'))
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByText(RESULT_A.title))

    expect(pushMock).toHaveBeenCalledWith(RESULT_A.href)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("a selected result appears under Recent the next time the palette opens", async () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    fireEvent.click(screen.getByText('Open Search (test)'))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText(RESULT_A.title))

    fireEvent.click(screen.getByText('Open Search (test)'))
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Recent')).toBeInTheDocument()
  })

  it("Escape closes the palette", async () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    fireEvent.click(screen.getByText('Open Search (test)'))
    const dialog = await screen.findByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("Ctrl+K opens the palette from anywhere", async () => {
    render(<Harness index={[RESULT_A, RESULT_B]} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it("renders ErrorState instead of the command list when the index fetch itself failed (e.g. live mode) — never confused with a genuinely empty query", async () => {
    render(<Harness index={[]} errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    fireEvent.click(screen.getByText('Open Search (test)'))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/not yet integrated/i)
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
  })
})
