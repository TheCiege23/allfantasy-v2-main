import { type SocialPlatform } from "./types"

interface SocialPublishPlatformHealth {
  platform: SocialPlatform
  providerId: string | null
  adapterAvailable: boolean
  configured: boolean
  requiredEnvKeys: string[]
  connectedTargets: number
  autoPostEnabledTargets: number
  pendingCount: number
  successLast24h: number
  failedLast24h: number
  providerUnavailableLast24h: number
  lastStatus: string | null
  lastPublishAt: string | null
  latestResponseMetadata: Record<string, unknown> | null
  latestErrorSummary: string | null
}

export interface SocialPublishHealthStatus {
  generatedAt: string
  platforms: SocialPublishPlatformHealth[]
}

