import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { CLUBHOUSE_NAME } from '@/lib/community/channels'
import { getCommunityViewer } from '@/lib/community/service'
import { ClubhouseFrame, PageHeader, loginHref } from '@/components/community/CommunityBits'
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
    <ClubhouseFrame narrow crumbs={[{ href: '/clubhouse', label: CLUBHOUSE_NAME }]}>
      <PageHeader icon="✍️" eyebrow="New thread" title="Start a post" sub="Pick a channel, say your piece. Links work, and @username mentions someone." />
      <PostComposer initialChannel={channel ?? 'commish-corner'} />
    </ClubhouseFrame>
  )
}
