import { notFound } from 'next/navigation'
import { ChimmyManagerTradesPreview } from './ChimmyManagerTradesPreview'

/** Dev-only: the commissioner's "Chimmy as a manager" panel with sample teams and no network. */
export default function ChimmyManagerTradesPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <ChimmyManagerTradesPreview />
}
