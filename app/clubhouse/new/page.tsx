import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CLUBHOUSE_NAME } from '@/lib/community/channels'
import { getCommunityViewer } from '@/lib/community/service'
import { ClubhouseFrame, loginHref } from '@/components/community/CommunityBits'
import { PostComposer } from '@/components/community/PostComposer'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `New post | ${CLUBHOUSE_NAME} | AllFantasy`,
  robots: { index: false },
}

type Props = { searchParams: Promise<{ channel?: string }> }

export default async function ClubhouseNewPostPage({ searchParams }: Props) {
  const { channel } = await searchParams
  const viewer = await getCommunityViewer()
  if (!viewer.userId) {
    redirect(loginHref(`/clubhouse/new${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`))
  }

  return (
    <ClubhouseFrame crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <h1 className="mb-4 text-2xl font-bold" style={{ color: 'var(--text)' }}>
        Start a post
      </h1>
      <PostComposer initialChannel={channel ?? 'commish-corner'} />
    </ClubhouseFrame>
  )
}
