'use client'

import { createContext, useContext } from 'react'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { CoreDepthLockCta } from '@/components/core-app/CoreDepthLockCta'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreDepthLockCopy } from '@/lib/core-app/coreDepthLockCopy'

/**
 * AF ADP's lock in the draft rooms (owner, 2026-11-22: AF ADP is AF Pro, AF Commissioner or AF Supreme).
 *
 * The pool response already arrives WITHOUT AF ADP for a viewer whose plan does not include it
 * (lib/core-app/afIntelligenceWithhold.ts) and carries `afIntelligenceLock`. The room puts that lock here once, and
 * the pool table reads it: the AF ADP column stays visible, each cell shows a lock rather than a dash (a dash reads
 * "nobody has drafted him"), and the column header becomes the ONE upgrade link — one tracked link per table, not one
 * per row. The link is `data-ios-purchase` through CoreDepthLockCta, so an iOS build that sells nothing hides it.
 */
export const AfAdpLockContext = createContext<CoreDepthAccess | null>(null)

export function useAfAdpLock(): CoreDepthAccess | null {
  return useContext(AfAdpLockContext)
}

/** The lock's tooltip, in the reader's language (lib/core-app/messages/coreDepthLock.ts). */
export function afAdpLockedTitle(language?: string | null): string {
  return coreDepthLockCopy(language).afAdpLockedTitle
}
/** English, for callers outside a language provider. */
export const AF_ADP_LOCKED_TITLE = afAdpLockedTitle('en')

/** Read the lock off a pool response. PURE. */
export function afAdpLockOf(payload: unknown): CoreDepthAccess | null {
  const lock = payload && typeof payload === 'object' ? (payload as { afIntelligenceLock?: unknown }).afIntelligenceLock : null
  return lock && typeof lock === 'object' && (lock as { unlocked?: unknown }).unlocked === false ? (lock as CoreDepthAccess) : null
}

export function AfAdpLockedCell() {
  const title = afAdpLockedTitle(useOptionalLanguage().language)
  return (
    <span className="text-[11px] text-white/40" title={title} aria-label={title}>
      🔒
    </span>
  )
}

export function AfAdpLockedHeader({ lock, label, source }: { lock: CoreDepthAccess; label: string; source: string }) {
  return (
    <CoreDepthLockCta
      href={lock.upgradePath}
      source={source}
      requiredPlan={lock.planName}
      className="inline-flex items-center gap-1 rounded px-1 py-px normal-case tracking-normal text-[#8b91a7] hover:text-white"
      testId="af-adp-lock-cta"
    >
      <span aria-hidden>🔒</span>
      <span>{label}</span>
    </CoreDepthLockCta>
  )
}
