import { randomUUID } from 'node:crypto'
import { getPrivateChatFile, putPrivateChatFile, privateChatStorageConfigured } from '@/lib/chat-core/privateStorage'
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
export function ownsChimmyScreenshot(path: string, userId: string): boolean {
  const parts = path.split('/')
  return /^[a-zA-Z0-9_-]+$/.test(userId) && parts.length === 3 && parts[0] === 'chimmy-screenshots' && parts[1] === userId && /^[a-zA-Z0-9_-]+\.(png|jpg|webp|gif)$/.test(parts[2])
}
export async function storeChimmyScreenshot(userId: string, file: File) {
  const extension = TYPES[file.type]
  if (!extension || !/^[a-zA-Z0-9_-]+$/.test(userId) || !privateChatStorageConfigured()) return null
  try {
    const path = await putPrivateChatFile('chimmy-screenshots/' + userId + '/' + randomUUID() + '.' + extension, file, file.type)
    if (!ownsChimmyScreenshot(path, userId)) return null
    return { url: '/api/chat/chimmy?attachment=' + encodeURIComponent(path), name: file.name.slice(0, 180) }
  } catch { console.warn('[chimmy] private screenshot storage unavailable'); return null }
}
export async function readChimmyScreenshot(path: string, userId: string) {
  if (!ownsChimmyScreenshot(path, userId)) return null
  const file = await getPrivateChatFile(path)
  return file && TYPES[file.contentType] ? file : null
}
