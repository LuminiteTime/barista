import { request } from 'node:http'

export type SocketReply = { status: number; body: unknown }

/** One JSON request to the daemon over its unix socket. */
export function callDaemon(socketPath: string, method: string, path: string, body?: unknown): Promise<SocketReply> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: { 'content-type': 'application/json' } }, res => {
      let text = ''
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
