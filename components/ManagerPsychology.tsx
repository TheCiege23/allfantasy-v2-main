'use client'
import BehaviorProfilesPanel from '@/components/app/settings/BehaviorProfilesPanel'
export default function ManagerPsychology({ leagueId }: { leagueId: string; rosterId: number; username?: string | null; teamData: unknown }) {
  return <BehaviorProfilesPanel leagueId={leagueId} />
}
