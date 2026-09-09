import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { HelpCenterView } from "@/components/commissioner-os/help/HelpCenterView"
import { stubHelpClient } from "@/lib/commissioner-ui/help/decision-os-client/stub"
import { demoHelpClient } from "@/lib/commissioner-ui/help/decision-os-client/demo"
import { liveHelpClient } from "@/lib/commissioner-ui/help/decision-os-client/live"
import { CATALOG_REVISED_AT } from "@/lib/commissioner-ui/help/helpCatalog"
import { stubDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/stub"
import { demoActivityClient } from "@/lib/commissioner-ui/activity/decision-os-client/demo"
import { demoNotificationsClient } from "@/lib/commissioner-ui/notifications/decision-os-client/demo"
import type { CommissionerHelpArticleContract, CommissionerGlossaryTermContract } from "@/lib/commissioner-ui/contracts"

const ARTICLE_A: CommissionerHelpArticleContract = {
  id: 'article-a', slug: 'article-a', title: 'How League Health Scoring Works', category: 'workflows',
  summary: 'What the score measures.', body: 'Full explanation of the League Health score.',
  relatedModuleIds: ['league-health'], relatedLinks: [{ moduleId: 'league-health', label: 'View League Health', href: '/commissioner-os/league-health' }],
  updatedAt: new Date().toISOString(),
}
const ARTICLE_B: CommissionerHelpArticleContract = {
  id: 'article-b', slug: 'article-b', title: 'Welcome to Commissioner OS', category: 'getting-started',
  summary: 'Orientation to Mission Control.', body: 'Full welcome text.',
  updatedAt: new Date().toISOString(),
}
const TERM_A: CommissionerGlossaryTermContract = { id: 'term-a', term: 'Recommendation', definition: 'A suggested action.' }

describe("commissioner-os help — client parity", () => {
  it("stub, demo, and live all satisfy the same method surface", () => {
    for (const client of [stubHelpClient, demoHelpClient, liveHelpClient]) {
      expect(typeof client.getArticles).toBe('function')
      expect(typeof client.getGlossary).toBe('function')
    }
  })

  /*
   * 🛑 THIS ASSERTED THAT LIVE MODE RETURNS AN ERROR, AND CALLED IT "an honest, typed
   * placeholder". It was honest, and it was also why a paying commissioner opened Help & Knowledge
   * Center and found nothing, while the twelve articles explaining the product sat in a file only Demo
   * Mode could read.
   *
   * The original argument was that `source: 'live'` should mean one consistent thing across all twelve
   * namespaces. Help is genuinely the exception: every other namespace answers a question about YOUR
   * league and needs a backend to do it, while Help answers questions about the PRODUCT and that
   * content ships inside the deployment. There is no upstream that could be unavailable.
   */
  it("serves the same catalog in every mode, tagged with the mode that served it", async () => {
    for (const method of ['getArticles', 'getGlossary'] as const) {
      const stubResponse = await stubHelpClient[method]()
      const demoResponse = await demoHelpClient[method]()
      expect(stubResponse.source).toBe('stub')
      expect(stubResponse.error).toBeNull()
      expect(demoResponse.source).toBe('demo')
      expect(demoResponse.error).toBeNull()

      const liveResponse = await liveHelpClient[method]()
      expect(liveResponse.source).toBe('live')
      expect(liveResponse.error).toBeNull()
      expect(liveResponse.data?.length ?? 0).toBeGreaterThan(0)
      // One catalog, not a live-only copy that could drift from what Demo Mode shows in a sales call.
      expect(liveResponse.data).toEqual(demoResponse.data)
    }
  })

  it("stamps articles with the date the prose was authored, not the moment they were read", async () => {
    const { data } = await liveHelpClient.getArticles()
    const stamps = new Set((data ?? []).map((article) => article.updatedAt))
    /*
     * `updatedAt` used to be `new Date().toISOString()` evaluated per read, so every article claimed to
     * have been updated that instant — the one field a reader uses to judge whether documentation can
     * be trusted. One shared constant is the fix, and a set of size 1 is how it is asserted.
     */
    expect(stamps.size).toBe(1)
    expect([...stamps][0]).toBe(CATALOG_REVISED_AT)
  })

  it("demo articles span multiple categories — a believable knowledge base, not a single-topic list", async () => {
    const response = await demoHelpClient.getArticles()
    const categories = new Set(response.data!.map((article) => article.category))
    expect(categories.size).toBeGreaterThan(1)
    expect(response.data!.length).toBeGreaterThan(5)
  })

  it("demo glossary has multiple, distinct terms", async () => {
    const response = await demoHelpClient.getGlossary()
    const terms = new Set(response.data!.map((term) => term.term))
    expect(terms.size).toBe(response.data!.length)
    expect(response.data!.length).toBeGreaterThan(3)
  })

  it("no article carries anything beyond the platform contract's own fields — never a duplicated copy of a module's real data", async () => {
    const response = await demoHelpClient.getArticles()
    const allowedKeys = new Set(['id', 'slug', 'title', 'category', 'summary', 'body', 'relatedModuleIds', 'relatedLinks', 'updatedAt'])
    for (const article of response.data!) {
      for (const key of Object.keys(article)) {
        expect(allowedKeys.has(key)).toBe(true)
      }
      expect(article.body.length).toBeGreaterThan(0)
    }
  })

  it("no glossary term carries anything beyond the platform contract's own fields", async () => {
    const response = await demoHelpClient.getGlossary()
    const allowedKeys = new Set(['id', 'term', 'definition', 'relatedModuleIds'])
    for (const term of response.data!) {
      for (const key of Object.keys(term)) {
        expect(allowedKeys.has(key)).toBe(true)
      }
    }
  })
})

describe("commissioner-os help — ownership boundaries (approved blueprint constraints)", () => {
  it("Mission Control's own client has no help-related method — Mission Control gets a header entry point only, never a summary", () => {
    const client = stubDecisionOSClient as Record<string, unknown>
    expect(client.getHelpSummary).toBeUndefined()
    expect(client.getHelpArticles).toBeUndefined()
  })

  it("Activity Stream never carries a help-sourced event — publishing or reading help content is not a logged operational event", async () => {
    const response = await demoActivityClient.getEvents()
    for (const event of response.data ?? []) {
      expect(event.sourceModuleId).not.toBe('help')
    }
  })

  it("Notification Center never carries a help-sourced notification — help content changes never generate a notification", async () => {
    const response = await demoNotificationsClient.getNotifications()
    for (const notification of response.data ?? []) {
      expect(notification.sourceModuleId).not.toBe('help')
    }
  })
})

describe("commissioner-os help — HelpCenterView", () => {
  it("renders the preview data banner, the All tab, and every article's summary", () => {
    render(<HelpCenterView articles={[ARTICLE_A, ARTICLE_B]} glossary={[TERM_A]} dataMode="demo" />)

    expect(screen.getByRole('status')).toHaveTextContent(/preview data/i)
    expect(screen.getByRole('tab', { name: /All \(2\)/ })).toBeInTheDocument()
    expect(screen.getByText(ARTICLE_A.summary)).toBeInTheDocument()
    expect(screen.getByText(ARTICLE_B.summary)).toBeInTheDocument()
  })

  it("filtering by category narrows the visible articles", () => {
    render(<HelpCenterView articles={[ARTICLE_A, ARTICLE_B]} glossary={[TERM_A]} dataMode="demo" />)

    fireEvent.click(screen.getByRole('tab', { name: /Workflows/ }))

    expect(screen.getByText(ARTICLE_A.summary)).toBeInTheDocument()
    expect(screen.queryByText(ARTICLE_B.summary)).not.toBeInTheDocument()
  })

  it("the local text filter narrows both articles and glossary terms together", () => {
    render(<HelpCenterView articles={[ARTICLE_A, ARTICLE_B]} glossary={[TERM_A]} dataMode="demo" />)

    fireEvent.change(screen.getByRole('searchbox', { name: /search help articles and glossary/i }), { target: { value: 'League Health' } })

    expect(screen.getByText(ARTICLE_A.summary)).toBeInTheDocument()
    expect(screen.queryByText(ARTICLE_B.summary)).not.toBeInTheDocument()
    expect(screen.queryByText(TERM_A.definition)).not.toBeInTheDocument()
  })

  it("expanding an article reveals its full body and related links; collapsing hides them again", () => {
    render(<HelpCenterView articles={[ARTICLE_A]} glossary={[]} dataMode="demo" />)

    expect(screen.queryByText(ARTICLE_A.body)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Read more/ }))

    expect(screen.getByText(ARTICLE_A.body)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View League Health' })).toHaveAttribute('href', '/commissioner-os/league-health')

    fireEvent.click(screen.getByRole('button', { name: /Show less/ }))
    expect(screen.queryByText(ARTICLE_A.body)).not.toBeInTheDocument()
  })

  it("shows an affirmative empty state when no article matches", () => {
    render(<HelpCenterView articles={[ARTICLE_A]} glossary={[]} dataMode="demo" />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search help articles and glossary/i }), { target: { value: 'zzz-no-match-zzz' } })
    expect(screen.getByText('No articles match.')).toBeInTheDocument()
  })

  it("renders the glossary section with term and definition", () => {
    render(<HelpCenterView articles={[]} glossary={[TERM_A]} dataMode="demo" />)
    expect(screen.getByText('Glossary')).toBeInTheDocument()
    expect(screen.getByText(TERM_A.term)).toBeInTheDocument()
    expect(screen.getByText(TERM_A.definition)).toBeInTheDocument()
  })

  it("renders ErrorState instead of the tablist and articles when an error is present", () => {
    render(<HelpCenterView articles={[]} glossary={[]} dataMode="live" errorMessage="The live Decision OS backend is not yet integrated in this environment." />)
    expect(screen.getByRole('alert')).toHaveTextContent(/not yet integrated/i)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it("hides the preview data banner in live mode", () => {
    render(<HelpCenterView articles={[]} glossary={[]} dataMode="live" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
