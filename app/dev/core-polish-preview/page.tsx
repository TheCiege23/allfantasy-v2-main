import { notFound } from 'next/navigation'
import CorePolishPreview from './CorePolishPreview'
export default function Page() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <CorePolishPreview />
}
