import type { CommissionerPlatformResponse, CommissionerRecommendationContract } from '../../contracts'

/**
 * Recommendations Center owns the full recommendation lifecycle. Mission
 * Control and League Health preview a subset; this is the canonical
 * queue every recommendation, regardless of which module generated it,
 * lives in.
 */
export interface RecommendationsClient {
  getQueue(): Promise<CommissionerPlatformResponse<CommissionerRecommendationContract[]>>
}
