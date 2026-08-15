'use client'

import DashboardContent from '@/app/dashboard/DashboardContent'

export function DashboardSoccerGroupingHarnessClient() {
  return (
    <DashboardContent
      user={{
        id: 'e2e-user',
        username: 'e2euser',
        displayName: 'E2E User',
        email: 'e2e@example.com',
        emailVerified: true,
        avatarUrl: null,
      }}
      profile={{
        sleeperUsername: null,
        isVerified: true,
        isAgeConfirmed: true,
        profileComplete: true,
      }}
      leagues={[
        {
          id: 'soccer-e2e-123',
          name: 'Soccer Dashboard Harness League',
          tournamentId: 't-e2e',
          memberCount: 12,
          leagueTier: 1,
          inTierRange: true,
          joinCode: 'SOCCER123',
        },
      ]}
      entries={[]}
      userCareerTier={1}
      onboardingComplete
      retentionNudges={[]}
    />
  )
}
