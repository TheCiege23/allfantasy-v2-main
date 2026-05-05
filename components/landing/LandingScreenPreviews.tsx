'use client'

import Link from 'next/link'
import Image from 'next/image'
import {
  BarChart3,
  ClipboardList,
  DraftingCompass,
  LayoutDashboard,
  Network,
  Shield,
  Trophy,
  Users,
} from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { trackLandingCtaClick } from '@/lib/landing-analytics'

const PREVIEWS = [
  {
    id: 'trade-analyzer',
    titleKey: 'landing.previews.tradeAnalyzer.title',
    descriptionKey: 'landing.previews.tradeAnalyzer.description',
    href: '/trade-analyzer',
    icon: BarChart3,
    snippetKey: 'landing.previews.tradeAnalyzer.snippet',
    image: '/branding/allfantasy-ai-for-fantasy-sports-logo.png',
  },
  {
    id: 'waiver-ai',
    titleKey: 'landing.previews.waiverAi.title',
    descriptionKey: 'landing.previews.waiverAi.description',
    href: '/waiver-wire',
    icon: ClipboardList,
    snippetKey: 'landing.previews.waiverAi.snippet',
    image: '/branding/allfantasy-colorful-logo.png',
  },
  {
    id: 'draft-helper',
    titleKey: 'landing.previews.draftHelper.title',
    descriptionKey: 'landing.previews.draftHelper.description',
    href: '/draft-helper',
    icon: DraftingCompass,
    snippetKey: 'landing.previews.draftHelper.snippet',
    image: '/branding/allfantasy-crest-chatgpt.png',
  },
  {
    id: 'war-room',
    titleKey: 'landing.previews.warRoom.title',
    descriptionKey: 'landing.previews.warRoom.description',
    href: '/war-room',
    icon: Shield,
    snippetKey: 'landing.previews.warRoom.snippet',
    image: '/branding/allfantasy-legacy-tool-logo.png',
  },
  {
    id: 'bracket',
    titleKey: 'landing.previews.bracket.title',
    descriptionKey: 'landing.previews.bracket.description',
    href: '/brackets',
    icon: Trophy,
    snippetKey: 'landing.previews.bracket.snippet',
    image: '/branding/allfantasy-wordmark-logo.png',
  },
  {
    id: 'playoff-bracket',
    titleKey: 'landing.previews.playoffBracket.title',
    descriptionKey: 'landing.previews.playoffBracket.description',
    href: '/brackets',
    icon: Network,
    snippetKey: 'landing.previews.playoffBracket.snippet',
    image: '/branding/allfantasy-black-white-logo.png',
  },
  {
    id: 'draft-room',
    titleKey: 'landing.previews.draftRoom.title',
    descriptionKey: 'landing.previews.draftRoom.description',
    href: '/mock-draft',
    icon: LayoutDashboard,
    snippetKey: 'landing.previews.draftRoom.snippet',
    image: '/branding/allfantasy-crest-chatgpt.png',
  },
  {
    id: 'ai-analysis',
    titleKey: 'landing.previews.aiAnalysis.title',
    descriptionKey: 'landing.previews.aiAnalysis.description',
    href: '/trade-analyzer',
    icon: BarChart3,
    snippetKey: 'landing.previews.aiAnalysis.snippet',
    image: '/branding/allfantasy-ai-for-fantasy-sports-logo.png',
  },
  {
    id: 'league-dashboard',
    titleKey: 'landing.previews.leagueDashboard.title',
    descriptionKey: 'landing.previews.leagueDashboard.description',
    href: '/dashboard',
    icon: LayoutDashboard,
    snippetKey: 'landing.previews.leagueDashboard.snippet',
    image: '/branding/allfantasy-colorful-logo.png',
  },
  {
    id: 'player-comparison',
    titleKey: 'landing.previews.playerComparison.title',
    descriptionKey: 'landing.previews.playerComparison.description',
    href: '/player-comparison',
    icon: Users,
    snippetKey: 'landing.previews.playerComparison.snippet',
    image: '/branding/allfantasy-wordmark-logo.png',
  },
] as const

export default function LandingScreenPreviews() {
  const { t } = useLanguage()
  return (
    <section
      className="px-4 py-12 sm:px-6 sm:py-16"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '900px' }}
    >
      <div className="mx-auto max-w-4xl">
        <h2
          className="text-center text-lg font-semibold sm:text-xl"
          style={{ color: 'var(--text)' }}
          data-testid="landing-example-previews-heading"
        >
          {t('landing.previews.heading')}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm" style={{ color: 'var(--muted)' }}>
          {t('landing.previews.subheading')}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PREVIEWS.map((preview) => {
            const Icon = preview.icon
            const title = t(preview.titleKey)
            const description = t(preview.descriptionKey)
            const snippet = t(preview.snippetKey)
            return (
              <Link
                key={preview.href + preview.titleKey}
                href={preview.href}
                prefetch={false}
                className="group flex flex-col rounded-2xl border p-5 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
                style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
                onClick={() =>
                  trackLandingCtaClick({
                    cta_label: title,
                    cta_destination: preview.href,
                    cta_type: 'tool_card',
                    source: 'screen_preview',
                  })
                }
                data-testid={`landing-screen-preview-${preview.id}`}
              >
                <div
                  className="mb-3 overflow-hidden rounded-xl border"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
                >
                  <Image
                    src={preview.image}
                    alt={`${title} preview`}
                    width={1200}
                    height={700}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    quality={72}
                    loading="lazy"
                    className="h-28 w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-emerald-400" />
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>
                    {title}
                  </span>
                </div>
                <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
                  {description}
                </p>
                <div
                  className="mt-3 rounded-xl border px-3 py-2 text-xs font-mono"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel2)', color: 'var(--muted)' }}
                >
                  {snippet}
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
