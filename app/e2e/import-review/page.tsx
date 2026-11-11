import { notFound } from 'next/navigation'
import ImportReviewHarnessClient from './ImportReviewHarnessClient'

/** Dev-only harness for the "Review your import" panel with a fixture league. */
export default function E2EImportReviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <ImportReviewHarnessClient />
}
