import { notFound } from 'next/navigation'
import { ImportV4 } from '@/components/core-app/screens/ImportV4'
import { normalizeIncomingImportProvider } from '@/lib/import/importSearchParams'
import { MockFetch } from './MockFetch'

/**
 * Design harness for /import. The real route redirects to /login before rendering, so the screen
 * cannot be reviewed without a session; this renders the same component with no auth and stubbed
 * data. `?provider=` picks the platform the way the real deep links do; `?mock=leagues` returns a
 * league list from discovery, `?mock=espn-connected` reports ESPN as connected.
 */
export const dynamic = 'force-dynamic'

export default async function ImportHarness({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const raw = typeof sp.provider === 'string' ? sp.provider : ''
  const mode = typeof sp.mock === 'string' ? sp.mock : 'none'
  const provider = normalizeIncomingImportProvider(raw) ?? 'sleeper'
  return (
    <>
      <MockFetch mode={mode} />
      <ImportV4 defaultProvider={provider} viewerEmail="preview@example.com" />
    </>
  )
}
