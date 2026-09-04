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
            score: 0,
            tier: 'standard',
            baseline: 100,
            deductions: [],
            subScores: { engagement: 0, retention: 0, competitiveBalance: 0, risk: 0 },
          }
        }
        risks={risksResponse.data ?? []}
        evidence={evidenceResponse.data ?? []}
        recommendations={recommendationsResponse.data ?? []}
      />
    </CommissionerPageContainer>
  )
}
