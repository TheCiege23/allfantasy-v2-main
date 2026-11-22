import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SpecialtyFormatPreview } from '@/components/specialty-preview/SpecialtyFormatPreview'
import { SPECIALTY_PREVIEW_FORMATS, getSpecialtyPreview } from '@/lib/specialty-preview/formats'

/**
 * /formats/king-of-the-hill — a static preview for a format that has art but no engine yet. See
 * lib/specialty-preview/formats.ts for why there is no rules list here. /formats/pirate used to
 * live here too; Pirate shipped, so that path now 308s to /league-types/pirate (next.config.js).
 */
export const dynamicParams = false

export function generateStaticParams() {
  return Object.keys(SPECIALTY_PREVIEW_FORMATS).map((format) => ({ format }))
}

type Params = { params: Promise<{ format: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const format = getSpecialtyPreview((await params).format)
  if (!format) return {}
  return {
    title: `${format.name} leagues · Coming soon | AllFantasy`,
    description: format.tagline,
  }
}

export default async function SpecialtyFormatPreviewPage({ params }: Params) {
  const format = getSpecialtyPreview((await params).format)
  if (!format) notFound()
  return <SpecialtyFormatPreview format={format} />
}
