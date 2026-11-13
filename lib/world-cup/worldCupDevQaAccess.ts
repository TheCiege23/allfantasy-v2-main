import "server-only"

export function verifyWorldCupDevQaRequest(request: Request): boolean {
  if (process.env.NODE_ENV === "development") {
    return true
  }
  const secret = process.env.WORLD_CUP_DEV_QA_SECRET?.trim()
  if (!secret) {
    return false
  }
  const auth = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  return auth === secret
}
