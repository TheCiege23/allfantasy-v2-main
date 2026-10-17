'use client'

import { useState } from 'react'
import NextLink from 'next/link'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { HELP_CATEGORY_LABELS, HELP_CATEGORY_ICONS } from './helpLabels'
import type { CommissionerHelpArticleContract } from '@/lib/commissioner-ui/contracts'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { helpText, relatedLinkText, toolsText } from '@/lib/commissioner-os/i18n/toolsCopy'

export interface HelpArticleCardProps {
  article: CommissionerHelpArticleContract
}

/**
 * In-place detail, per the approved blueprint §9 — expanding an article
 * reveals its full body inline via local component state, never a
 * `[slug]` dynamic route (this program has zero dynamic routes across
 * every module built so far). `relatedLinks` are the only way this card
 * ever references another module — never that module's own data.
 */
export function HelpArticleCard({ article }: HelpArticleCardProps) {
  const [expanded, setExpanded] = useState(false)
  const CategoryIcon = HELP_CATEGORY_ICONS[article.category]
  const { language } = useOptionalLanguage()
  const t = (english: string) => toolsText(english, language)

  return (
    <Card id={article.slug}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{helpText(article.title, language)}</CardTitle>
          <Badge variant="outline" className="flex shrink-0 items-center gap-1">
            <CategoryIcon size={12} aria-hidden />
            {t(HELP_CATEGORY_LABELS[article.category])}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {helpText(article.summary, language)}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="focus-ring link-themed flex items-center gap-1 text-xs"
        >
          {expanded ? (
            <>
              {t('Show less')} <ChevronUp size={14} aria-hidden />
            </>
          ) : (
            <>
              {t('Read more')} <ChevronDown size={14} aria-hidden />
            </>
          )}
        </button>
        {expanded && (
          <div className="space-y-2 pt-1">
            <p className="text-sm" style={{ color: 'var(--text)' }}>
              {helpText(article.body, language)}
            </p>
            {article.relatedLinks && article.relatedLinks.length > 0 && (
              <div className="flex flex-wrap gap-3 pt-1">
                {article.relatedLinks.map((link) => (
                  <NextLink key={link.href} href={link.href} className="focus-ring link-themed text-xs">
                    {relatedLinkText(link.label, language)}
                  </NextLink>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
