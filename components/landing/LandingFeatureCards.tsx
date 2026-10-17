'use client'

import Link from 'next/link'
import {
  ArrowRight,
  BarChart3,
  DraftingCompass,
  GraduationCap,
  Layers3,
  Target,
  Users,
} from 'lucide-react'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

const FEATURE_CARDS = [
  {
    titleKey: 'landing.tools.tradeAnalyzer.title',
    descriptionKey: 'landing.tools.tradeAnalyzer.description',
    href: '/trade-analyzer',
    icon: BarChart3,
  },
  {
    titleKey: 'landing.tools.waiverWireAi.title',
    descriptionKey: 'landing.tools.waiverWireAi.description',
    href: '/waiver-wire',
    icon: Layers3,
  },
  {
    titleKey: 'landing.tools.draftAssistant.title',
    descriptionKey: 'landing.tools.draftAssistant.description',
    href: '/draft-helper',
    icon: DraftingCompass,
  },
  {
    titleKey: 'landing.tools.playerComparisonLab.title',
    descriptionKey: 'landing.tools.playerComparisonLab.description',
    href: '/player-comparison',
    icon: Users,
  },
  {
    titleKey: 'landing.tools.matchupSimulator.title',
    descriptionKey: 'landing.tools.matchupSimulator.description',
    // /matchup-simulator is a 308 to /core/matchup since 2026-09-29 — link the destination.
    href: '/core/matchup',
    icon: Target,
  },
  {
    titleKey: 'landing.tools.fantasyCoach.title',
    descriptionKey: 'landing.tools.fantasyCoach.description',
    href: '/fantasy-coach',
    icon: GraduationCap,
  },
] as const

export default function LandingFeatureCards() {
  const { t } = useLanguage()
  return (
    <section
      className="border-t px-4 py-12 sm:px-6 sm:py-16"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--panel) 30%, transparent)',
        contentVisibility: 'auto',
        containIntrinsicSize: '720px',
      }}
    >
      <div className="mx-auto max-w-4xl">
        <h2
          className="text-center text-lg font-semibold sm:text-xl"
          style={{ color: 'var(--text)' }}
          data-testid="landing-what-you-can-do-heading"
        >
          {t('landing.whatYouCanDo.heading')}
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm" style={{ color: 'var(--muted)' }}>
          {t('landing.whatYouCanDo.subheading')}
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_CARDS.map((card) => {
            const Icon = card.icon
            const title = t(card.titleKey)
            const description = t(card.descriptionKey)
            return (
              <Link
                key={card.href}
                href={card.href}
                prefetch={false}
                className="group flex flex-col rounded-2xl border p-5 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
                style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
                onClick={() => trackLandingCtaClick({ cta_label: title, cta_destination: card.href, cta_type: 'feature_card', source: 'landing' })}
                data-testid={`landing-tool-card-${title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                    style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}
                  >
                    <Icon className="h-5 w-5 text-emerald-400" />
                  </div>
                  <span className="font-semibold" style={{ color: 'var(--text)' }}>
                    {title}
                  </span>
                </div>
                <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                  {description}
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 group-hover:underline">
                  {t('landing.tools.open')}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
