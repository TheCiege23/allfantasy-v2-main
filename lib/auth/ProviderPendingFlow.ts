import { safeInternalPathOr } from '@/lib/auth/auth-intent-resolver'
import type { SocialProvider } from '@/lib/auth/SocialProviderResolver'

export function buildProviderPendingHref(input: {
  provider: SocialProvider
  callbackUrl: string
}): string {
  const safeCallback = safeInternalPathOr(input.callbackUrl, '/core')
  return `/auth/provider-pending?provider=${encodeURIComponent(input.provider)}&callbackUrl=${encodeURIComponent(safeCallback)}`
}
