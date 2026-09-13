export const SHARE_VIDEO_FORMATS = [
  { mime: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
  { mime: 'video/mp4', extension: 'mp4' },
  { mime: 'video/webm;codecs=vp9', extension: 'webm' },
  { mime: 'video/webm;codecs=vp8', extension: 'webm' },
  { mime: 'video/webm', extension: 'webm' },
] as const

export type ShareVideoFormat = (typeof SHARE_VIDEO_FORMATS)[number]

/** Prefer broadly shareable MP4, then the best WebM codec the browser records. */
export function chooseShareVideoFormat(
  isSupported: (mime: string) => boolean,
): ShareVideoFormat | null {
  return SHARE_VIDEO_FORMATS.find(({ mime }) => isSupported(mime)) ?? null
}

