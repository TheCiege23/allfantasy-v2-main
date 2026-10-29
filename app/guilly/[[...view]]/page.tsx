import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { GuillySetup } from '@/components/guilly/GuillySetup'
import { GuillyHome } from '@/components/guilly/GuillyHome'

/**
 * One route file for every Guilly surface, because the app sits at the route-count ceiling
 * (see app/api/leagues/join/route.ts):
 *   /guilly/setup        commissioner setup (creates an NBA guillotine league through existing routes)
 *   /guilly/<leagueId>   the hub, over the existing guillotine summary API
 */
export const metadata: Metadata = { title: 'Guilly | AllFantasy' }

export default async function GuillyPage({ params }: { params: Promise<{ view?: string[] }> }) {
  const { view = [] } = await params
  if (view.length === 0 || (view.length === 1 && view[0] === 'setup')) return <GuillySetup />
  if (view.length === 1) return <GuillyHome leagueId={view[0]} />
  notFound()
}
