import { notFound } from 'next/navigation'

import E2EDraftApiControlsClient from './E2EDraftApiControlsClient'

export default async function E2EDraftApiControlsPage({
  searchParams,
}: {
  searchParams?: Promise<{ leagueId?: string | string[] }>
}) {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  const sp = searchParams ? await searchParams : {}
  const raw = sp.leagueId
  const leagueId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] ?? '' : ''

  return <E2EDraftApiControlsClient leagueId={leagueId} />
}
