import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MyPlayersClient } from './MyPlayersClient'

export const dynamic = 'force-dynamic'

export default async function MyPlayersPage() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    redirect('/login')
  }

  return <MyPlayersClient />
}
