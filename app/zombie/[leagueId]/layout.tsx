import ZombieLeagueShell from './ZombieLeagueShell'
import { ZombieToastContainer } from '@/app/zombie/components/ZombieNotificationToast'

export default async function ZombieLeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ leagueId: string }>
}) {
  const { leagueId } = await params
  return (
    <div className="af-draft-dark min-h-screen bg-[var(--zombie-bg)] text-[var(--zombie-text-mid)] antialiased">
      <ZombieLeagueShell leagueId={leagueId}>{children}</ZombieLeagueShell>
      <ZombieToastContainer />
    </div>
  )
}
