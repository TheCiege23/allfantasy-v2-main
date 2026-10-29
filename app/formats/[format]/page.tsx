import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SpecialtyFormatPreview } from '@/components/specialty-preview/SpecialtyFormatPreview'
import { SPECIALTY_PREVIEW_FORMATS, getSpecialtyPreview } from '@/lib/specialty-preview/formats'

/**
 * /formats/king-of-the-hill and /formats/pirate — static previews for formats that have art but
 * no engine yet. See lib/specialty-preview/formats.ts for why there is no rules list here.
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
