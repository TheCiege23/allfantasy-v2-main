'use client'

import { InfoTip } from '@/components/core-app/InfoTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { helpTopic, type HelpTopicId } from '@/lib/core-app/helpTopics'

/**
 * `<InfoTip>` filled from the shared topic dictionary (lib/core-app/helpTopics.ts), in the reader's
 * language. NOT a second "?" control: InfoTip is the one control; this only supplies its words, so a
 * term explained on two screens says the same thing on both.
 */
export function TopicTip({ topic }: { topic: HelpTopicId }) {
  const { language } = useOptionalLanguage()
  const t = helpTopic(topic, language)
  return (
    <InfoTip label={language === 'es' ? `Qué significa «${t.title}»` : `What “${t.title}” means`} title={t.title}>
      <span className="af-info-para">{t.body}</span>
    </InfoTip>
  )
}

export default TopicTip
