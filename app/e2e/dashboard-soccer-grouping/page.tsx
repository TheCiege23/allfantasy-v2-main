import DashboardContent from '@/app/dashboard/DashboardContent'

export default function DashboardSoccerGroupingHarnessPage() {
  return (
    <DashboardContent
      user={{
        id: 'e2e-user',
        username: 'audit-manager',
        displayName: 'Audit Manager',
        email: 'audit@example.com',
        emailVerified: true,
        avatarUrl: null,
      }}
      profile={{
        sleeperUsername: 'audit_manager',
        isVerified: true,
        isAgeConfirmed: true,
        profileComplete: true,
      }}
      leagues={[]}
      entries={[
        {
          id: 'entry-1',
          name: 'Audit Bracket',
          tournamentId: 'tournament-1',
          score: 42,
        },
      ]}
      connectedLeagues={[
        {
          id: 'soccer-e2e-123',
          sourceLeagueId: 'soccer-e2e-123',
          name: 'Soccer Dashboard Harness League',
          sport: 'SOCCER',
          platform: 'manual',
          format: 'redraft',
          teamCount: 12,
          season: 2026,
          status: 'pre_draft',
          syncStatus: 'manual',
        },
      ]}
      userCareerTier={3}
    />
  )
}
