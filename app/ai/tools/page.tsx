import type { Metadata } from 'next'
import AIToolsPageClient from './AIToolsPageClient'

export const metadata: Metadata = {
  title: 'AF Intelligence Hub | Chimmy Fantasy Tools | AllFantasy',
  description:
    'The AF Intelligence Hub gives you Chimmy-powered tools for every stage of the fantasy season — lineup decisions, draft strategy, trade analysis, waiver recommendations, and league management.',
}

export default function AIToolsPage() {
  return <AIToolsPageClient />
}
