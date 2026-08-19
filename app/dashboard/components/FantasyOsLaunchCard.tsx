'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import type { FantasyOsAccessView } from '@/lib/fantasy-os/access'

/**
 * Dashboard launch card for the Fantasy OS enterprise workspace.
 *
 * Rendered ONLY for authorized users (owner / admin / enterprise) — visibility is decided upstream
 * by the server resolver (`resolveFantasyOsAccessView`), never here. This component only chooses the
 * copy variant and links to `/fantasy-os`. It never re-checks authorization, never links an
 * unauthorized user into the protected workspace, and never surfaces internal authorization details
 * (entitlements, admin flags, plan ids) or the internal engine name ("Decision OS").
 *
 * The `/fantasy-os` route guard remains the security boundary; this card is convenience only.
 */
export function FantasyOsLaunchCard({ reason }: { reason: FantasyOsAccessView['reason'] }) {
  const isOwnerOrAdmin = reason === 'owner' || reason === 'admin'
  const workspaceLabel = isOwnerOrAdmin ? 'Enterprise Workspace' : 'Executive Workspace'

  return (
    <Link
      href="/fantasy-os"
      data-testid="dashboard-fantasy-os-launch-card"
      aria-label="Open Fantasy OS"
      className="card-premium group flex items-center gap-3 p-4 transition hover:border-brand-primary/25 hover:bg-surface-hover"
    >
      <span
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-primary/25 bg-brand-primary/[0.08] text-brand-primary"
        aria-hidden
      >
        <Sparkles className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-primary">Fantasy OS</span>
        <span className="block truncate text-xs text-secondary">
          {workspaceLabel}
          {isOwnerOrAdmin ? ' · Owner Access' : ''}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-brand-primary">Open Fantasy OS →</span>
    </Link>
  )
}
