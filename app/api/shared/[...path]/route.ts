import { NextRequest, NextResponse } from 'next/server'
import { proxyToExisting } from '@/lib/api/proxy-adapter'

function notMapped(path: string[], method: string) {
  return NextResponse.json(
    {
      error: 'SHARED_NAMESPACE_ADAPTER_NOT_MAPPED',
      message: `No stable proxy mapping for ${method} /api/shared/${path.join('/')}`,
    },
    { status: 501 },
  )
}

function chatThreadPath(path: string[]): string | null {
  if (!(path[0] === 'chat' && path[1] === 'threads')) return null
  if (!path[2]) return '/api/shared/chat/threads'
  if (!path[3]) return `/api/shared/chat/threads/${encodeURIComponent(path[2])}`

  if (['messages', 'media', 'polls', 'pin', 'broadcast'].includes(path[3])) {
    return `/api/shared/chat/threads/${encodeURIComponent(path[2])}/${path[3]}`
  }

  return null
}

function notificationReadPath(path: string[]): string | null {
  if (path[0] !== 'notifications') return null
  if (path[1] === 'read-all') return '/api/shared/notifications/read-all'
  if (path[1] && path[2] === 'read') return `/api/shared/notifications/${encodeURIComponent(path[1])}/read`
  return null
}

export async function GET(req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params
  const path = params.path || []

  if (path[0] === 'auth' && path[1] === 'me') return proxyToExisting(req, { targetPath: '/api/auth/me' })
  if (path[0] === 'profile') return proxyToExisting(req, { targetPath: '/api/auth/me' })
  if (path[0] === 'verification' && path[1] === 'status') return proxyToExisting(req, { targetPath: '/api/auth/me' })

  if (path[0] === 'wallet') return proxyToExisting(req, { targetPath: '/api/shared/wallet' })
  if (path[0] === 'notifications') return proxyToExisting(req, { targetPath: '/api/shared/notifications' })
  if (path[0] === 'quick-ai') return proxyToExisting(req, { targetPath: '/api/shared/quick-ai' })

  const chatPath = chatThreadPath(path)
  if (chatPath) return proxyToExisting(req, { targetPath: chatPath })
  if (path[0] === 'chat' && path[1] === 'mentions') return proxyToExisting(req, { targetPath: '/api/shared/chat/mentions' })
  if (path[0] === 'chat' && path[1] === 'blocked') return proxyToExisting(req, { targetPath: '/api/shared/chat/blocked' })

  if (path[0] === 'rankings') return proxyToExisting(req, { targetPath: '/api/rankings' })
  if (path[0] === 'news' && path[1] === 'feed') return proxyToExisting(req, { targetPath: '/api/sports/news' })
  if (path[0] === 'imports') return proxyToExisting(req, { targetPath: '/api/legacy/import/status' })

  return notMapped(path, 'GET')
}

export async function POST(req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params
  const path = params.path || []

  if (path[0] === 'auth' && path[1] === 'login') return proxyToExisting(req, { targetPath: '/api/auth/login' })
  if (path[0] === 'auth' && path[1] === 'signup') return proxyToExisting(req, { targetPath: '/api/auth/register' })
  if (path[0] === 'auth' && path[1] === 'logout') return proxyToExisting(req, { targetPath: '/api/auth/logout' })
  if (path[0] === 'auth' && path[1] === 'forgot-password' && path[2] === 'email') return proxyToExisting(req, { targetPath: '/api/auth/password/reset/request' })
  if (path[0] === 'auth' && path[1] === 'reset-password') return proxyToExisting(req, { targetPath: '/api/auth/password/reset/confirm' })

  if (path[0] === 'verification' && path[1] === 'email' && path[2] === 'send') return proxyToExisting(req, { targetPath: '/api/auth/verify-email/send' })
  if (path[0] === 'verification' && path[1] === 'email' && path[2] === 'confirm') return proxyToExisting(req, { targetPath: '/api/auth/verify-email' })
  if (path[0] === 'verification' && path[1] === 'phone' && path[2] === 'send') return proxyToExisting(req, { targetPath: '/api/verify/phone/start' })
  if (path[0] === 'verification' && path[1] === 'phone' && path[2] === 'confirm') return proxyToExisting(req, { targetPath: '/api/verify/phone/check' })

  if (path[0] === 'wallet' && path[1] === 'deposit') return proxyToExisting(req, { targetPath: '/api/shared/wallet/deposit' })
  if (path[0] === 'wallet' && path[1] === 'withdraw') return proxyToExisting(req, { targetPath: '/api/shared/wallet/withdraw' })

  if (path[0] === 'chat' && path[1] === 'block') return proxyToExisting(req, { targetPath: '/api/shared/chat/block' })

  const chatPath = chatThreadPath(path)
  if (chatPath) return proxyToExisting(req, { targetPath: chatPath })

  if (path[0] === 'ai' && (path[1] === 'query' || path[1] === 'chat' || path[1] === 'recommendation' || path[1] === 'explain')) {
    return proxyToExisting(req, { targetPath: '/api/chat/chimmy' })
  }

  if (path[0] === 'news' && path[1] === 'refresh') return proxyToExisting(req, { targetPath: '/api/news-crawl' })
  if (path[0] === 'imports') return proxyToExisting(req, { targetPath: '/api/legacy/import' })

  return notMapped(path, 'POST')
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params
  const path = params.path || []

  if (path[0] === 'profile') return proxyToExisting(req, { targetPath: '/api/auth/complete-profile', method: 'PATCH' })

  const notificationPath = notificationReadPath(path)
  if (notificationPath) return proxyToExisting(req, { targetPath: notificationPath, method: 'PATCH' })

  return notMapped(path, 'PATCH')
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params
  const path = params.path || []
  if (path[0] === 'auth' && path[1] === 'logout') return proxyToExisting(req, { targetPath: '/api/auth/logout', method: 'DELETE' })
  return notMapped(path, 'DELETE')
}
