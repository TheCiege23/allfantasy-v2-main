import type { PlayerHighlight } from '@/lib/highlights/types'

/** NFL rights holders can reject embeds even when the public API says embeddable. */
export default function HighlightVideos({ videos }: { videos: PlayerHighlight[] }) {
  return <>{videos.map(video => <article className="af-pc-highlight" key={video.videoId}>
    <span className="af-pc-highlight-kind">{video.kind === 'player' ? 'PLAYER HIGHLIGHT' : 'TEAM GAME RECAP'}</span>
    <a className="af-pc-highlight-preview" href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noopener noreferrer" aria-label={`Watch on YouTube: ${video.title}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={video.thumbnailUrl} alt="" loading="lazy" width={320} height={180} />
      <span aria-hidden="true">▶ Watch on YouTube ↗</span>
    </a>
    <a className="af-pc-highlight-title" href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noopener noreferrer">{video.title}</a>
    <div className="af-pc-faint"><a href={`https://www.youtube.com/channel/${video.channelId}`} target="_blank" rel="noopener noreferrer">{video.channelTitle}</a>{' · '}<time dateTime={video.publishedAt}>{video.publishedAt.slice(0, 10)}</time></div>
  </article>)}</>
}
