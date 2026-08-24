import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * `/dashboard` is retired — `/core` is the one signed-in home. Middleware
 * already 307s every `/dashboard` hit to `/core` (query preserved) before this
 * page can execute; the stub exists so a direct render without middleware
 * still lands on `/core` instead of 404ing, and so the dead 341-line
 * composition this file used to hold stops type-checking against deleted
 * screens.
 */
export default function DashboardRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === 'string') qs.set(key, value)
    else if (Array.isArray(value)) for (const v of value) qs.append(key, v)
  }
  const suffix = qs.toString()
  redirect(suffix ? `/core?${suffix}` : '/core')
}
