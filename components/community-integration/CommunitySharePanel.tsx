'use client'

/**
 * Discord and Reddit integration panel (PROMPT 298).
 * Share to Discord (copy or webhook), Reddit-ready post (copy title/body, submit URL).
 */

import { useCallback, useState } from 'react'
import { buildDiscordShareContent, buildRedditReadyPost } from '@/lib/community-integration'
import type { CommunityShareInput } from '@/lib/community-integration/types'

interface CommunitySharePanelProps {
  input: CommunityShareInput
  /** Optional: show Discord webhook form */
  showWebhook?: boolean
  className?: string
}

export function CommunitySharePanel({
  input,
  showWebhook = false,
  className = '',
}: CommunitySharePanelProps) {
  const [discordCopied, setDiscordCopied] = useState(false)
  const [redditTitleCopied, setRedditTitleCopied] = useState(false)
  const [redditBodyCopied, setRedditBodyCopied] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookLoading, setWebhookLoading] = useState(false)
  const [webhookError, setWebhookError] = useState<string | null>(null)

  const discord = buildDiscordShareContent(input)
  const reddit = buildRedditReadyPost(input)

  const copyDiscord = useCallback(() => {
    navigator.clipboard.writeText(discord.copyText).then(() => {
      setDiscordCopied(true)
      setTimeout(() => setDiscordCopied(false), 2000)
    })
  }, [discord.copyText])

  const copyRedditTitle = useCallback(() => {
    navigator.clipboard.writeText(reddit.title).then(() => {
      setRedditTitleCopied(true)
      setTimeout(() => setRedditTitleCopied(false), 2000)
    })
  }, [reddit.title])

  const copyRedditBody = useCallback(() => {
    navigator.clipboard.writeText(reddit.body).then(() => {
      setRedditBodyCopied(true)
      setTimeout(() => setRedditBodyCopied(false), 2000)
    })
  }, [reddit.body])

  const postToWebhook = useCallback(async () => {
    const url = webhookUrl.trim()
    if (!url) return
    setWebhookLoading(true)
    setWebhookError(null)
    try {
      const res = await fetch('/api/community/discord/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: url,
          ...input,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setWebhookError(data.error || 'Failed to post')
        return
      }
    } catch (e) {
      setWebhookError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setWebhookLoading(false)
    }
  }, [webhookUrl, input])

  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2">Share to Discord</h3>
        <p className="text-xs text-white/60 mb-2">Copy and paste into your Discord channel:</p>
        <button
          type="button"
          onClick={copyDiscord}
          className="rounded-lg bg-[#5865F2]/20 text-white px-3 py-2 text-sm font-medium hover:bg-[#5865F2]/30"
        >
          {discordCopied ? 'Copied!' : 'Copy for Discord'}
        </button>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-2">Reddit-ready post</h3>
        <p className="text-xs text-white/60 mb-2">Copy title and body, then submit to r/fantasyfootball or r/DynastyFF:</p>
        <div className="flex flex-wrap gap-2 mb-2">
          <button
            type="button"
            onClick={copyRedditTitle}
            className="rounded-lg bg-orange-600/20 text-white px-3 py-2 text-sm font-medium hover:bg-orange-600/30"
          >
            {redditTitleCopied ? 'Copied!' : 'Copy title'}
          </button>
          <button
            type="button"
            onClick={copyRedditBody}
            className="rounded-lg bg-orange-600/20 text-white px-3 py-2 text-sm font-medium hover:bg-orange-600/30"
          >
            {redditBodyCopied ? 'Copied!' : 'Copy body'}
          </button>
          {reddit.submitUrl && (
            <a
              href={reddit.submitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-orange-600/20 text-white px-3 py-2 text-sm font-medium hover:bg-orange-600/30"
            >
              Open Reddit submit
            </a>
          )}
        </div>
        <p className="text-xs text-white/50">Suggested: {reddit.suggestedSubreddits.map((r) => `r/${r}`).join(', ')}</p>
      </div>

      {showWebhook && (
        <div>
          <h3 className="text-sm font-semibold text-white/90 mb-2">Post to Discord (webhook)</h3>
          <p className="text-xs text-white/60 mb-2">
            Add a webhook in your Discord channel (Server Settings → Integrations → Webhooks), then paste the URL below.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="flex-1 min-w-[200px] rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40"
            />
            <button
              type="button"
              onClick={postToWebhook}
              disabled={webhookLoading || !webhookUrl.trim()}
              className="rounded-lg bg-[#5865F2] text-white px-4 py-2 text-sm font-medium hover:bg-[#4752c4] disabled:opacity-50"
            >
              {webhookLoading ? 'Posting…' : 'Post to channel'}
            </button>
          </div>
          {webhookError && <p className="text-sm text-red-400 mt-1">{webhookError}</p>}
        </div>
      )}
    </div>
  )
}
