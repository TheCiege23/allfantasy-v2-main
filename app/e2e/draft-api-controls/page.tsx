import { notFound } from 'next/navigation'
import E2EDraftApiControlsClient from './E2EDraftApiControlsClient'

export default function E2EDraftApiControlsPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <E2EDraftApiControlsClient />
}
