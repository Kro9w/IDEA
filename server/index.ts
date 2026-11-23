import express from 'express'
import { resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import { db } from './db.js'
import { apiRouter } from './routes.js'
import { stopCloudflareTunnel } from './cloudflareTunnel.js'

const app = express()
const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use((request, response, next) => {
  if (!request.get('cf-connecting-ip')) {
    next()
    return
  }

  const visitorPage = request.method === 'GET' && /^\/session\/[^/]+\/?$/.test(request.path)
  const visitorSession = request.method === 'GET' && /^\/api\/sessions\/[^/]+$/.test(request.path)
  const visitorSubmission = request.method === 'POST' && /^\/api\/sessions\/[^/]+\/distributions$/.test(request.path)
  const visitorImage = request.method === 'GET' && /^\/uploads\/[^/]+$/.test(request.path)
  const visitorAsset = request.method === 'GET'
    && (request.path.startsWith('/assets/') || request.path === '/NFRDI.png')

  if (visitorPage || visitorSession || visitorSubmission || visitorImage || visitorAsset) {
    next()
    return
  }

  response.sendStatus(404)
})
app.use('/api', apiRouter)

app.get('/api/health', (_request, response) => {
  const result = db.prepare('SELECT 1 AS ok').get() as { ok: number }
  response.json({
    status: 'ok',
    database: result.ok === 1 ? 'connected' : 'error',
  })
})

app.use('/uploads', express.static(resolve(process.env.IDEA_UPLOAD_DIR ?? 'uploads'), {
  fallthrough: true,
  index: false,
}))

app.use(express.static(resolve('dist')))
app.get(/.*/, (_request, response) => {
  response.sendFile(resolve('dist', 'index.html'))
})

const server = app.listen(port, host, () => {
  console.log(`IDEA API listening on http://${host}:${port}`)
  const lanAddress = Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .find((address) => address.family === 'IPv4' && !address.internal && address.address.startsWith('192.168.'))
  if (lanAddress && process.env.NODE_ENV === 'production') {
    console.log(`IDEA LAN address: http://${lanAddress.address}:${port}`)
  }
})

function shutdown() {
  void stopCloudflareTunnel().finally(() => {
    server.close(() => process.exit(0))
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
