import type { Metadata } from 'next'
import AISystemExplainerPage from '@/components/ai-hub/AISystemExplainerPage'
import { buildSeoMeta } from '@/lib/seo'
import { getWebPageSchema } from '@/lib/seo'
import { PageJsonLd } from '@/components/seo/JsonLd'

export const metadata: Metadata = buildSeoMeta({
  title: 'AllFantasy AI System Explainer – Chimmy, Deterministic AI, and Provider Roles',
  description:
    'Learn how AllFantasy AI works across the app: Chimmy, deterministic-first intelligence, orchestration modes, and OpenAI/DeepSeek/xAI provider roles.',
  canonicalPath: '/ai',
  openGraphTitle: 'AllFantasy AI System Explainer',
  openGraphDescription:
    'How AllFantasy combines deterministic engines with multi-provider AI across leagues, bracket, dynasty, creator, legacy, and analytics surfaces.',
  twitterTitle: 'AllFantasy AI System Explainer',
  twitterDescription: 'Understand Chimmy, deterministic AI, provider roles, and orchestration modes.',
})

const AI_PAGE_SCHEMA = getWebPageSchema({
  name: 'AllFantasy Chimmy System Explainer',
  description:
    'Explainer page for AllFantasy Chimmy architecture: deterministic-first intelligence, provider roles, orchestration modes, and platform-wide Chimmy surfaces.',
  url: '/ai',
})

export default function AIPage() {
  return (
    <>
      <PageJsonLd schemas={[AI_PAGE_SCHEMA]} />
      <AISystemExplainerPage />
    </>
  )
}
