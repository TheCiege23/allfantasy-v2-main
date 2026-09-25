/**
 * Rich message — emoji, GIF, image, file attachment services and safe renderer.
 */

export {
  EMOJI_CATEGORIES,
  EMOJI_LIST,
  insertEmojiAtPosition,
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
  MAX_IMAGE_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_FILE_TYPES,
  validateImageFile,
  validateAttachmentFile,
  getMessagePayloadForImage,
  getMessagePayloadForGif,
  getMessagePayloadForFile,
} from "./MessageAttachmentService"
export type { ImagePreview, GifPreview, FilePreview, AttachmentPreview } from "./MessageAttachmentService"

export {
  hasAttachmentPreview,
  getAttachmentPreviewLabel,
  canSendComposerMessage,
  clearAttachmentState,
} from "./AttachmentPreviewController"

export { RichMessageRenderer } from "./RichMessageRenderer"
export type { RichMessageRendererProps } from "./RichMessageRenderer"

export { getSafeMessageMediaUrl, isSafeToRenderMedia } from "./safeMedia"

export {
  resolveMediaViewerUrl,
  canOpenInMediaViewer,
  getMediaViewerAriaLabel,
} from "./MediaViewerController"
