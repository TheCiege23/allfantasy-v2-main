import { notFound } from 'next/navigation'
import { ImportPreviewHarnessClient } from './ImportPreviewHarnessClient'

export default function E2EImportPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <ImportPreviewHarnessClient />
}
