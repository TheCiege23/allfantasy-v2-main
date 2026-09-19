import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { get, put } from '@vercel/blob'

type PrivateS3Config = { endpoint: string; region: string; bucketName: string; accessKeyId: string; secretAccessKey: string; urlStyle?: string }

function s3Config(): PrivateS3Config | null {
  const raw = process.env.CHAT_PRIVATE_S3_CONFIG
  if (!raw) return null
  const config = JSON.parse(raw) as PrivateS3Config
  if (!config.endpoint || !config.region || !config.bucketName || !config.accessKeyId || !config.secretAccessKey) throw new Error('Private storage configuration is incomplete')
  if (new URL(config.endpoint).protocol !== 'https:') throw new Error('Private storage requires HTTPS')
  return config
}

function client(config: PrivateS3Config) {
  return new S3Client({
    endpoint: config.endpoint, region: config.region,
    forcePathStyle: config.urlStyle === 'path',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })
}

export function privateChatStorageConfigured(): boolean {
  return Boolean(process.env.CHAT_PRIVATE_S3_CONFIG || process.env.CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN)
}

export async function putPrivateChatFile(key: string, file: Blob, contentType: string): Promise<string> {
  const config = s3Config()
  if (config) {
    const s3 = client(config)
    try {
      await s3.send(new PutObjectCommand({ Bucket: config.bucketName, Key: key, Body: Buffer.from(await file.arrayBuffer()), ContentType: contentType, CacheControl: 'private, no-store' }))
      return key
    } finally { s3.destroy() }
  }
  const token = process.env.CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('Private storage unavailable')
  const blob = await put(key, file, { access: 'private', contentType, token })
  return blob.pathname
}

export async function getPrivateChatFile(key: string): Promise<{ stream: ReadableStream; contentType: string } | null> {
  const config = s3Config()
  if (config) {
    // Keep the SDK client alive until the streamed response has been consumed.
    const s3 = client(config)
    try {
      const object = await s3.send(new GetObjectCommand({ Bucket: config.bucketName, Key: key }))
      if (!object.Body) { s3.destroy(); return null }
      const reader = object.Body.transformToWebStream().getReader()
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const result = await reader.read()
            if (result.done) { controller.close(); s3.destroy() }
            else controller.enqueue(result.value)
          } catch (error) { controller.error(error); s3.destroy() }
        },
        async cancel() { try { await reader.cancel() } finally { s3.destroy() } },
      })
      return { stream, contentType: object.ContentType || 'application/octet-stream' }
    } catch (error) {
      s3.destroy()
      if ((error as { name?: string }).name === 'NoSuchKey') return null
      throw error
    }
  }
  const token = process.env.CHAT_PRIVATE_BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error('Private storage unavailable')
  const blob = await get(key, { access: 'private', token, useCache: false })
  return blob?.statusCode === 200 ? { stream: blob.stream, contentType: blob.blob.contentType } : null
}
