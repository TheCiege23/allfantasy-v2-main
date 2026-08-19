import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveTenantBrand } from '@/lib/white-label'
import { canAccessFantasyOS } from '@/lib/fantasy-os/access'
import { fetchExecSnapshot } from '@/lib/fantasy-os/exec-data/client'
import { deriveAll } from '@/lib/fantasy-os/exec-intelligence/derive'
import { ExecutiveWorkspace } from '@/components/fantasy-os/executive/ExecutiveWorkspace'
import { resolveSeasonState } from '@/lib/fantasy-os/sync/season'
import { buildFreshness } from '@/lib/fantasy-os/sync/freshness'
import { EXEC_SOURCE_PROVIDER } from '@/lib/fantasy-os/exec-intelligence/truth'

const BRAND = resolveTenantBrand()

export const metadata: Metadata = {
  title: `${BRAND.copy.productName} — Executive Intelligence`,
  description: 'Deterministic executive intelligence over a certified league portfolio.',
}

export const dynamic = 'force-dynamic'

/**
 * Executive Intelligence workspace — enterprise-gated deep surface under /fantasy-os.
 *
 * Security: re-checks canAccessFantasyOS (defense in depth over the /fantasy-os guard). Data: reads the
 * certified NON-PRODUCTION `fos_phase4` portfolio through the env-gated, read-only data-access boundary.
 * Fails CLOSED with an explicit unavailable state — never fabricates data to populate the UI.
 */
export default async function ExecutiveIntelligencePage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null; role?: string | null }
  } | null
  const userId = typeof session?.user?.id === 'string' ? session.user.id.trim() : ''

  const allowed = await canAccessFantasyOS({
    userId: userId || null,
    email: session?.user?.email ?? null,
    role: session?.user?.role ?? null,
  })
  if (!allowed) redirect('/dashboard')

  const result = await fetchExecSnapshot()
  if (!result.available) {
    return <ExecutiveUnavailable reason={result.reason} detail={result.detail} productName={BRAND.copy.productName} />
  }

  const data = deriveAll(result.snapshot)

  // Season-aware freshness: no scheduler has advanced past the certified import yet, so the last successful
  // sync is the certified import time. Freshness is truthful (may read "delayed") and never relabels data.
  const now = new Date()
  const { state: seasonState } = resolveSeasonState({ sport: 'nfl', provider: 'sleeper', now })
  const freshness = buildFreshness({
    seasonState,
    lastSuccessfulSyncAt: result.snapshot.run.importedAt,
    lastAttemptedSyncAt: result.snapshot.run.importedAt,
    now,
    sourceProvider: EXEC_SOURCE_PROVIDER,
    sourceWindowStart: data.platform.freshness.sourceWindowStart,
    sourceWindowEnd: data.platform.freshness.sourceWindowEnd,
  })

  return <ExecutiveWorkspace data={data} productName={BRAND.copy.productName} freshness={freshness} />
}

function ExecutiveUnavailable({ reason, detail, productName }: { reason: 'disabled' | 'unavailable'; detail: string; productName: string }) {
  const title = reason === 'disabled' ? 'Executive data source not enabled here' : 'Executive data source is temporarily unavailable'
  const body =
    reason === 'disabled'
      ? 'The certified portfolio data source is enabled only in approved environments. No data is shown — the workspace never falls back to fabricated or production data.'
      : 'The certified portfolio could not be reached. No cached or fabricated data is shown; please try again shortly.'
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-3 px-4 py-16 md:px-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{productName} · Executive Intelligence</p>
      <h1 className="text-xl font-black tracking-tight text-primary">{title}</h1>
      <p className="text-[14px] leading-relaxed text-secondary">{body}</p>
      <p className="rounded-lg border border-subtle bg-surface-muted/60 px-3 py-2 font-mono text-[11px] text-muted">{detail}</p>
    </div>
  )
}
