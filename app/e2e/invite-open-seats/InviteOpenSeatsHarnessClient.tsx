'use client'

import { OpenSeatLinks } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'

/** Sample data: three provider managers who have not joined since the league switched. */
const SEATS = [
  { rosterId: 'cm4seat0000000000003', teamName: 'Hammer Time', ownerName: 'joe_sleeper' },
  { rosterId: 'cm4seat0000000000007', teamName: 'Gridiron Gang', ownerName: 'kelly22' },
  { rosterId: 'cm4seat0000000000011', teamName: 'Waiver Wire Warriors', ownerName: 'tdawg' },
]

export default function InviteOpenSeatsHarnessClient() {
  return (
    <div className="min-h-screen bg-[#070b1c] p-4 text-white" data-testid="invite-open-seats-harness">
      <p className="mb-3 text-xs text-white/50">Sample data — the Invite panel of a league that switched to AllFantasy.</p>
      <div className="mx-auto max-w-lg rounded-xl border border-[#262c6a] bg-[#12163e]/70 p-4">
        <OpenSeatLinks inviteUrl="https://allfantasy.ai/join?code=K7QX2M" seats={SEATS} />
      </div>
    </div>
  )
}
