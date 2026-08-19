'use client'
/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * Deliberately minimal — no marketing hero, no auth-sensitive href resolution, no legacy stat rows.
 * This is a NEW page with zero existing traffic/expectations to preserve, so it starts from the
 * cleanest version of the "first 30 seconds" principle this whole OS suite has been working toward,
 * rather than inheriting `/commissioner-hub`'s own accumulated complexity.
 */
import Link from 'next/link'
import { LayoutGrid } from 'lucide-react'
import ManagerCommandCenterSection from '@/components/decision-os/ManagerCommandCenterSection'
import { resolveTenantBrand, tenantThemeStyle, isFeatureVisible } from '@/lib/white-label'

// The active licensee brand (Phase V5.0 white-label). Env-selected, resolved once per deployment.
const BRAND = resolveTenantBrand()

type ManagerHubPageClientProps = {
  leagues: { id: string; name: string }[]
  isAuthenticated: boolean
}

export default function ManagerHubPageClient({ leagues, isAuthenticated }: ManagerHubPageClientProps) {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10" style={tenantThemeStyle(BRAND)}>
      <div className="card-premium overflow-hidden p-5 sm:p-6">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-primary/25 bg-brand-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-primary">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{BRAND.copy.managerHubLabel}</span>
        </div>
        <h1 className="mt-3 text-[26px] font-black leading-tight tracking-tight text-primary sm:text-[32px]">
          What should you do to compete better this week?
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-secondary">
          Every team you play — commissioner, member, or imported — in one place, before you drill
          into any single league.
        </p>
        {!isAuthenticated ? (
          <Link
            href="/login?callbackUrl=/manager-hub"
            prefetch={false}
            className="focus-ring mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2.5 text-[14px] font-bold text-content-inverse shadow-[0_0_20px_rgba(245,158,11,0.25)] transition hover:from-amber-300 hover:to-amber-400 active:opacity-90"
          >
            Sign In
          </Link>
        ) : null}
      </div>

      <div className="mt-5">
        <ManagerCommandCenterSection
          leagues={leagues}
          platformScopeLabel={BRAND.copy.platformScopeLabel}
          showPlatformFocus={isFeatureVisible(BRAND, 'platformFocus')}
        />
      </div>
    </main>
  )
}
