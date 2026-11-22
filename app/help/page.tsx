import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { HelpCenter } from '@/components/support/HelpCenter'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Get help | AllFantasy',
  description: 'Message AllFantasy support and read our replies.',
}

/** /help — message AllFantasy and read the replies (lib/support). `?thread=` opens one conversation. */
export default async function HelpPage(props: { searchParams?: Promise<{ thread?: string }> }) {
  const [session, params] = await Promise.all([
    getServerSession(authOptions as never).catch(() => null) as Promise<{ user?: { id?: string } } | null>,
    props.searchParams ?? Promise.resolve({} as { thread?: string }),
  ])
  const thread = typeof params?.thread === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(params.thread) ? params.thread : null
  return <HelpCenter signedIn={Boolean(session?.user?.id)} initialThreadId={thread} />
}
