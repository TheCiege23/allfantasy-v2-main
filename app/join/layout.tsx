import { AndroidInviteAppPrompt } from '@/components/league-join/AndroidInviteAppPrompt'

export const dynamic = 'force-dynamic'

export default function JoinLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      {/* Android browsers only: open this invite in the app, or get it on Google Play. */}
      <AndroidInviteAppPrompt />
    </>
  )
}
