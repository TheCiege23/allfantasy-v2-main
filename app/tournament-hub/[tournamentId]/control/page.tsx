import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { loadControl } from '@/lib/tournament/divisions/lifecycle'
import { DivisionControl } from '@/components/tournament/divisions/DivisionControl'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Seeding and round control — AllFantasy', robots: { index: false, follow: false } }

/** Commissioner-only. Returns 404 rather than 403 so the page never confirms a tournament exists. */
export default async function DivisionsControlPage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) redirect('/api/auth/signin?callbackUrl=' + encodeURIComponent(`/tournament-hub/${tournamentId}/control`))
  const control = await loadControl(session.user.id, tournamentId)
  if (!control) notFound()
  return <DivisionControl control={control} />
}
