'use client'

import { LockedFeatureCard } from '@/components/subscription/LockedFeatureCard'

/**
 * What a member sees when Chimmy's league write-up is not available: the standard lock card when the
 * league's commissioner lacks AF Commissioner / AF Supreme (`feature_not_entitled`), or the server's own
 * line when the league has used today's write-ups (`daily_limit_reached`). The server writes the message
 * (English or Spanish), lib/league-story-ai/leagueStoryAiGate.ts.
 */
export type StoryAiLock = {
  code?: string
  message?: string
  requiredPlan?: string
  upgradePath?: string
  featureId?: string
} | null | undefined

export function isStoryAiLock(value: unknown): value is NonNullable<StoryAiLock> {
  if (!value || typeof value !== 'object') return false
  const code = (value as { code?: unknown }).code
  return code === 'feature_not_entitled' || code === 'daily_limit_reached'
}

export function StoryAiLockNotice({ lock, featureName, className = '' }: { lock: StoryAiLock; featureName: string; className?: string }) {
  if (!isStoryAiLock(lock)) return null
  if (lock.code === 'feature_not_entitled') {
    return (
      <LockedFeatureCard
        featureName={featureName}
        featureId={lock.featureId ?? 'storyline_creation'}
        requiredPlan={lock.requiredPlan ?? 'AF Commissioner'}
        upgradeHref={lock.upgradePath ?? '/pricing'}
        statusMessage={lock.message}
        className={className}
      />
    )
  }
  return <p className={`text-xs text-amber-300/80 ${className}`}>{lock.message}</p>
}
