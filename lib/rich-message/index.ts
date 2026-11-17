/**
 * Rich message — emoji, GIF, image, file attachment services and safe renderer.
 */

export {
  EMOJI_CATEGORIES,
  EMOJI_LIST,
  appendEmoji,
  getEmojiCategoryLabel,
} from "./EmojiPickerService"

export {
  isGifSearchConfigured,
  getGifProviderName,
  getGiphySearchUrl,
  isValidGifOrImageUrl,
  searchGifs,
} from "./GIFIntegrationResolver"
export type { GifSearchResult } from "./GIFIntegrationResolver"

export {
  validateImageFile,
  validateAttachmentFile,
  getMessagePayloadForImage,
  getMessagePayloadForGif,
  getMessagePayloadForFile,
} from "./MessageAttachmentService"
export type { AttachmentPreview } from "./MessageAttachmentService"

export {
  getAttachmentPreviewLabel,
  canSendComposerMessage,
  clearAttachmentState,
} from "./AttachmentPreviewController"

export { RichMessageRenderer } from "./RichMessageRenderer"

export { getSafeMessageMediaUrl, isSafeToRenderMedia } from "./safeMedia"

export {
  resolveMediaViewerUrl,
} from "./MediaViewerController"
