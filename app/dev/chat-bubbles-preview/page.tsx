import { notFound } from 'next/navigation'
import ChatBubblesPreview from './ChatBubblesPreview'

export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <ChatBubblesPreview />
}
