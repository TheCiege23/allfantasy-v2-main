import type { SocialProvider } from '@/lib/auth/SocialProviderResolver'

export function buildProviderPendingHref(input: {
  provider: SocialProvider
  callbackUrl: string
}): string {
  const safeCallback = input.callbackUrl.startsWith('/')
    ? input.callbackUrl
    : '/core'
  return `/auth/provider-pending?provider=${encodeURIComponent(input.provider)}&callbackUrl=${encodeURIComponent(safeCallback)}`
}
