import { redirect } from 'next/navigation'
import { ideaBoardHref } from '@/lib/community/ideas'

/** `/clubhouse/ideas` is not a channel; the board lives in League Lab. */
export default function IdeasIndexPage() {
  redirect(ideaBoardHref())
}
