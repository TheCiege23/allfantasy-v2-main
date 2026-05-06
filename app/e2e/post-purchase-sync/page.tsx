import { notFound } from 'next/navigation'
import { PostPurchaseSyncHarnessClient } from './PostPurchaseSyncHarnessClient'

export default function E2EPostPurchaseSyncPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <PostPurchaseSyncHarnessClient />
}
