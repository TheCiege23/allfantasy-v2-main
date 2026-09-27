export function readScreenshotPreview(file: File): Promise<string | null> {
  return new Promise<string | null>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.onabort = () => resolve(null)
    reader.readAsDataURL(file)
  }).catch(() => null)
}
