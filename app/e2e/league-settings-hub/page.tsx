import { notFound } from 'next/navigation'
import { HubPreviewClient } from './HubPreviewClient'

/**
 * Dev-only preview of the League Settings hub, rendered from fixtures through the real
 * view-model builders. 404s in production. `?type=guillotine&role=manager&tab=record`.
 */
export default async function LeagueSettingsHubPreviewPage(props: {
  searchParams?: Promise<{ type?: string; role?: string; tab?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = (await props.searchParams) ?? {}
  return <HubPreviewClient type={sp.type ?? 'redraft'} role={sp.role === 'manager' ? 'manager' : 'commish'} tab={sp.tab ?? 'setup'} />
}
