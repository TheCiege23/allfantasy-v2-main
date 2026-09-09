import { CommissionerPageContainer } from '@/components/commissioner-os/shell/CommissionerPageContainer'
import { LeagueHealthView } from '@/components/commissioner-os/league-health/LeagueHealthView'
import { getDecisionOSAdapter } from '@/lib/commissioner-ui/adapter'

export default async function LeagueHealthPage() {
  const adapter = await getDecisionOSAdapter()

  const [detailResponse, risksResponse, evidenceResponse, recommendationsResponse] = await Promise.all([
    adapter.leagueHealth.getHealthDetail(),
    adapter.leagueHealth.getRisks(),
    adapter.leagueHealth.getEvidence(),
    adapter.leagueHealth.getRecommendations(),
  ])

  return (
    <CommissionerPageContainer>
      <LeagueHealthView
        dataMode={adapter.mode}
        detail={
          detailResponse.data ?? {
            /*
             * The nothing-loaded fallback. Zeroes and `standard` throughout, so an unavailable
             * league reads as "no reading" rather than as a league scoring zero — the previous
             * fallback's `baseline: 100` minus nothing implied a perfect league whose score was 0.
             */
            score: 0,
            tier: 'standard',
            retentionRisk: 'standard',
            commissionerWorkload: 'standard',
            participation: { activeManagers: 0, totalManagers: 0 },
            completeness: 0,
          }
        }
        risks={risksResponse.data ?? []}
        evidence={evidenceResponse.data ?? []}
        recommendations={recommendationsResponse.data ?? []}
      />
    </CommissionerPageContainer>
  )
}
