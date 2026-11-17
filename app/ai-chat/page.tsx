import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import AIToolSeoLanding from '@/components/seo/AIToolSeoLanding'
import { LandingToolVisitTracker } from '@/components/landing/LandingToolVisitTracker'
import { AI_TOOL_PAGES, getAIToolPageCanonical, getAIToolPageJsonLd } from '@/lib/seo-landing/ai-tool-pages'
import { buildSeoMeta } from '@/lib/seo'
import { authOptions } from '@/lib/auth'
import { ChimmyChatShell } from '@/components/chimmy'

const slug = 'ai-chat'
const config = AI_TOOL_PAGES[slug]

export const metadata: Metadata = buildSeoMeta({
  title: config.title,
  description: config.description,
  canonical: getAIToolPageCanonical(slug),
})

export const dynamic = 'force-dynamic'

export default async function AIChatPage() {
  const jsonLd = getAIToolPageJsonLd(slug)

  let session: { user?: { id?: string } } | null = null
  try {
    session = (await getServerSession(authOptions as never)) as typeof session
  } catch (error) {
    console.error('[ai-chat] getServerSession failed:', error)
  }

  const isAuthenticated = Boolean(session?.user?.id)

  if (isAuthenticated) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-bold mode-text">Chimmy</h1>
          <p className="text-sm mode-muted">
            Your calm, evidence-based fantasy assistant. Ask about trades, waivers, drafts, or your league.
          </p>
          <p className="mt-1 text-xs mode-muted opacity-70" data-testid="ai-chat-cap-notice">
            Free: 3 Chimmy messages/day · <a href="/pricing" className="underline hover:opacity-100">Upgrade for more</a>
          </p>
        </header>
        <div className="flex min-h-[70vh] flex-1 flex-col rounded-2xl border mode-panel" style={{ borderColor: 'var(--border)' }}>
          <ChimmyChatShell />
        </div>
      </main>
    )
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <LandingToolVisitTracker path="/ai-chat" toolName="Chimmy Chat" />
      <AIToolSeoLanding config={config} />
    </>
  )
}
