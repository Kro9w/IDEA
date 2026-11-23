import ExcelJS from 'exceljs'
import express, { type Request, type Response } from 'express'
import multer from 'multer'
import { mkdirSync, unlinkSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { z } from 'zod'
import { db } from './db.js'
import {
  getCloudflareTunnelStatus,
  startCloudflareTunnel,
  stopCloudflareTunnel,
} from './cloudflareTunnel.js'

export const apiRouter = express.Router()

const uploadDir = resolve(process.env.IDEA_UPLOAD_DIR ?? 'uploads')
mkdirSync(uploadDir, { recursive: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('Only JPG, JPEG, PNG, and WebP images are supported'))
      return
    }
    callback(null, true)
  },
})

const sessionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  details: z.string().trim().max(2000).optional(),
  status: z.enum(['active', 'completed']).optional(),
  materialIds: z.array(z.string()).optional(),
  staffId: z.string().min(1).optional(),
})

const staffSchema = z.object({
  name: z.string().trim().min(1).max(200),
  active: z.boolean().optional(),
})

const materialSchema = z.object({
  title: z.string().trim().max(300).optional(),
  authorEditor: z.string().trim().min(1).max(300),
  identifyingDetails: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
})

const submissionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sex: z.enum(['Female', 'Male']),
  entries: z.array(z.object({
    materialId: z.string().min(1),
    quantity: z.number().int().min(1).max(999),
  })).min(1),
})

  function normalizePersonName(value: string): string {
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('en-PH')
      .replace(/(^|[\s'-])([a-z\u00C0-\u024F])/g, (_match, separator: string, letter: string) =>
        `${separator}${letter.toLocaleUpperCase('en-PH')}`,
      )
  }

function sendError(response: Response, status: number, message: string) {
  response.status(status).json({ error: message })
}

function parseBody<T>(schema: z.ZodType<T>, request: Request, response: Response): T | null {
  const result = schema.safeParse(request.body)
  if (!result.success) {
    sendError(response, 400, result.error.issues[0]?.message ?? 'Invalid request')
    return null
  }
  return result.data
}

function audit(entityType: string, entityId: string, action: string, changes: unknown, actor = 'administrator') {
  db.prepare(`
    INSERT INTO audit_log (id, entity_type, entity_id, action, changes_json, actor)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), entityType, entityId, action, JSON.stringify(changes), actor)
}

function routeParam(request: Request, name: 'id' | 'sessionId'): string {
  const value = request.params[name]
  return Array.isArray(value) ? value[0] : value
}

const tunnelStartSchema = z.object({
  webPort: z.number().int().min(1).max(65_535).optional(),
})

function publicOrigin(request: Request, webPort?: number): string {
  if (process.env.IDEA_PUBLIC_URL) {
    return process.env.IDEA_PUBLIC_URL.replace(/\/$/, '')
  }

  const host = request.get('host')
  if (host && !host.startsWith('localhost') && !host.startsWith('127.0.0.1') && !host.startsWith('[::1]')) {
    return `${request.protocol}://${host}`
  }

  const addresses = Object.values(networkInterfaces())
    .flatMap((interfaces) => interfaces ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
  const address = addresses.find((item) => item.address.startsWith('192.168.'))
    ?? addresses.find((item) => item.address.startsWith('10.'))
    ?? addresses[0]

  if (!address) return `${request.protocol}://${host ?? '127.0.0.1'}`

  const port = process.env.IDEA_PUBLIC_PORT
    ?? (process.env.NODE_ENV === 'production' ? '3001' : String(webPort ?? 5173))
  return `http://${address.address}:${port}`
}

apiRouter.get('/health', (_request, response) => {
  const result = db.prepare('SELECT 1 AS ok').get() as { ok: number }
  response.json({ status: 'ok', database: result.ok === 1 ? 'connected' : 'error' })
})

apiRouter.get('/tunnel/status', (_request, response) => {
  response.json(getCloudflareTunnelStatus())
})

apiRouter.post('/tunnel/start', async (request, response) => {
  const body = parseBody(tunnelStartSchema, request, response)
  if (!body) return
  try {
    const url = await startCloudflareTunnel(body.webPort)
    response.json({ running: true, url })
  } catch (error) {
    sendError(response, 503, error instanceof Error ? error.message : 'Could not start the Cloudflare tunnel')
  }
})

apiRouter.post('/tunnel/stop', async (_request, response) => {
  await stopCloudflareTunnel()
  response.json({ running: false, url: null })
})

apiRouter.get('/sessions', (_request, response) => {
  const sessions = db.prepare(`
    SELECT sessions.*, staff.name AS distributor_name
    FROM sessions
    LEFT JOIN staff ON staff.id = sessions.distributor_staff_id
    ORDER BY sessions.created_at DESC
  `).all()
  response.json(sessions)
})

apiRouter.post('/sessions', (request, response) => {
  const body = parseBody(sessionSchema, request, response)
  if (!body) return
  if (!body.staffId) {
    sendError(response, 400, 'Select one distributor for the session')
    return
  }
  const distributor = db.prepare('SELECT id, active FROM staff WHERE id = ?').get(body.staffId) as
    | { id: string; active: number }
    | undefined
  if (!distributor || distributor.active !== 1) {
    sendError(response, 400, 'Select an active session distributor')
    return
  }
  const id = randomUUID()
  const insert = db.transaction(() => {
    if ((body.status ?? 'active') === 'active') {
      db.prepare("UPDATE sessions SET status = 'completed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'active'")
        .run()
    }
    db.prepare(`
      INSERT INTO sessions (id, name, details, status, distributor_staff_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, body.name, body.details ?? null, body.status ?? 'active', distributor.id)
    if (body.materialIds) {
      const assign = db.prepare(`
        INSERT INTO session_materials (session_id, material_id, enabled)
        VALUES (?, ?, 1)
      `)
      for (const materialId of body.materialIds) assign.run(id, materialId)
    }
    audit('session', id, 'created', body)
  })
  insert()
  response.status(201).json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id))
})

apiRouter.patch('/sessions/:id', (request, response) => {
  const body = parseBody(sessionSchema.partial(), request, response)
  if (!body) return
  if (body.staffId) {
    const distributor = db.prepare('SELECT id, active FROM staff WHERE id = ?').get(body.staffId) as
      | { id: string; active: number }
      | undefined
    if (!distributor || distributor.active !== 1) {
      sendError(response, 400, 'Select an active session distributor')
      return
    }
  }
  const existing = db.prepare('SELECT * FROM sessions WHERE id = ?').get(request.params.id)
  if (!existing) {
    sendError(response, 404, 'Session not found')
    return
  }
  const update = db.transaction(() => {
    if (body.status === 'active') {
      db.prepare("UPDATE sessions SET status = 'completed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE status = 'active' AND id != ?")
        .run(request.params.id)
    }
    db.prepare(`
      UPDATE sessions
      SET name = COALESCE(?, name),
          details = COALESCE(?, details),
          status = COALESCE(?, status),
          distributor_staff_id = COALESCE(?, distributor_staff_id),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(body.name ?? null, body.details ?? null, body.status ?? null, body.staffId ?? null, request.params.id)
    if (body.materialIds) {
      db.prepare('DELETE FROM session_materials WHERE session_id = ?').run(request.params.id)
      const assign = db.prepare(`
        INSERT INTO session_materials (session_id, material_id, enabled)
        VALUES (?, ?, 1)
      `)
      for (const materialId of body.materialIds) assign.run(request.params.id, materialId)
    }
    audit('session', request.params.id, 'updated', body)
  })
  update()
  response.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(request.params.id))
})

apiRouter.delete('/sessions/:id', (request, response) => {
  const body = parseBody(z.object({
    confirmation: z.literal('DELETE SESSION'),
  }), request, response)
  if (!body) return

  const id = routeParam(request, 'id')
  const existing = db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(id) as
    | { id: string; name: string }
    | undefined
  if (!existing) {
    sendError(response, 404, 'Session not found')
    return
  }

  const removeSession = db.transaction(() => {
    const patronIds = db.prepare(`
      SELECT DISTINCT patron_id
      FROM distributions
      WHERE session_id = ?
    `).all(id) as Array<{ patron_id: string }>
    db.prepare(`
      DELETE FROM distribution_entries
      WHERE distribution_id IN (
        SELECT id FROM distributions WHERE session_id = ?
      )
    `).run(id)
    db.prepare(`
      UPDATE distributions
      SET corrected_by_distribution_id = NULL
      WHERE session_id = ?
    `).run(id)
    db.prepare('DELETE FROM distributions WHERE session_id = ?').run(id)
    for (const patron of patronIds) {
      db.prepare(`
        DELETE FROM patrons
        WHERE id = ? AND NOT EXISTS (
          SELECT 1 FROM distributions WHERE patron_id = ?
        )
      `).run(patron.patron_id, patron.patron_id)
    }
    db.prepare('DELETE FROM session_materials WHERE session_id = ?').run(id)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    audit('session', id, 'deleted', { name: existing.name })
  })

  removeSession()
  response.status(204).send()
})

apiRouter.get('/sessions/:id', (request, response) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(request.params.id)
  if (!session) {
    sendError(response, 404, 'Session not found')
    return
  }
  const materials = db.prepare(`
    SELECT m.*,
           COALESCE((
             SELECT SUM(de.quantity)
             FROM distributions d
             JOIN distribution_entries de ON de.distribution_id = d.id
             WHERE d.session_id = sm.session_id
               AND d.is_voided = 0
               AND de.material_id = m.id
           ), 0) AS distributed_quantity
    FROM session_materials sm
    JOIN materials m ON m.id = sm.material_id
    WHERE sm.session_id = ? AND sm.enabled = 1 AND m.active = 1
    ORDER BY distributed_quantity DESC,
             m.author_editor COLLATE NOCASE,
             m.title COLLATE NOCASE
  `).all(request.params.id)
  response.json({ session, materials })
})

apiRouter.get('/sessions/:id/qr', async (request, response) => {
  const session = db.prepare('SELECT id, name FROM sessions WHERE id = ?').get(request.params.id)
  if (!session) {
    sendError(response, 404, 'Session not found')
    return
  }
  const requestedMode = request.query.mode ?? 'lan'
  if (requestedMode !== 'lan' && requestedMode !== 'cloudflare') {
    sendError(response, 400, 'QR access mode must be lan or cloudflare')
    return
  }
  const rawWebPort = request.query.webPort
  let webPort: number | undefined
  if (rawWebPort !== undefined) {
    const parsedPort = z.coerce.number().int().min(1).max(65_535).safeParse(rawWebPort)
    if (!parsedPort.success) {
      sendError(response, 400, 'Invalid web server port')
      return
    }
    webPort = parsedPort.data
  }
  let origin = publicOrigin(request, webPort)
  if (requestedMode === 'cloudflare') {
    const tunnel = getCloudflareTunnelStatus()
    if (!tunnel.running || !tunnel.url) {
      sendError(response, 503, 'Start the Cloudflare tunnel in Settings before generating this QR code')
      return
    }
    origin = tunnel.url
  }
  const url = `${origin}/session/${encodeURIComponent(request.params.id)}`
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 480, margin: 2 })
    response.json({ url, dataUrl })
  } catch {
    sendError(response, 500, 'Could not generate QR code')
  }
})

apiRouter.get('/materials', (_request, response) => {
  response.json(db.prepare('SELECT * FROM materials ORDER BY author_editor COLLATE NOCASE, title COLLATE NOCASE').all())
})

apiRouter.post('/materials', (request, response) => {
  const body = parseBody(materialSchema, request, response)
  if (!body) return
  const id = randomUUID()
  db.prepare(`
    INSERT INTO materials (id, title, author_editor, identifying_details, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, body.title ?? null, body.authorEditor, body.identifyingDetails ?? null, body.active === false ? 0 : 1)
  audit('material', id, 'created', body)
  response.status(201).json(db.prepare('SELECT * FROM materials WHERE id = ?').get(id))
})

apiRouter.patch('/materials/:id', (request, response) => {
  const body = parseBody(materialSchema.partial(), request, response)
  if (!body) return
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(request.params.id)
  if (!existing) {
    sendError(response, 404, 'Material not found')
    return
  }
  db.prepare(`
    UPDATE materials
    SET title = COALESCE(?, title),
        author_editor = COALESCE(?, author_editor),
        identifying_details = COALESCE(?, identifying_details),
        active = COALESCE(?, active),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(
    body.title ?? null,
    body.authorEditor ?? null,
    body.identifyingDetails ?? null,
    body.active === undefined ? null : body.active ? 1 : 0,
    request.params.id,
  )
  audit('material', request.params.id, 'updated', body)
  response.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(request.params.id))
})

apiRouter.post('/materials/:id/image', upload.single('image'), async (request, response) => {
  if (!request.file) {
    sendError(response, 400, 'An image file is required')
    return
  }
  const existing = db.prepare('SELECT * FROM materials WHERE id = ?').get(request.params.id) as { image_path: string | null } | undefined
  if (!existing) {
    sendError(response, 404, 'Material not found')
    return
  }
  try {
    const filename = `${request.params.id}-${randomUUID()}.webp`
    const destination = resolve(uploadDir, filename)
    await sharp(request.file.buffer).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(destination)
    if (existing.image_path) {
      try {
        unlinkSync(resolve(uploadDir, existing.image_path))
      } catch {
        // The database reference is updated even if an older file is already absent.
      }
    }
    db.prepare('UPDATE materials SET image_path = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?')
      .run(filename, request.params.id)
    audit('material', routeParam(request, 'id'), 'image_updated', { filename })
    response.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(request.params.id))
  } catch {
    sendError(response, 500, 'Could not process uploaded image')
  }
})

apiRouter.delete('/materials/:id/image', (request, response) => {
  const existing = db.prepare('SELECT image_path FROM materials WHERE id = ?').get(request.params.id) as { image_path: string | null } | undefined
  if (!existing) {
    sendError(response, 404, 'Material not found')
    return
  }
  if (existing.image_path) {
    try {
      unlinkSync(resolve(uploadDir, existing.image_path))
    } catch {
      // A missing file should not prevent removal of the database reference.
    }
  }
  db.prepare('UPDATE materials SET image_path = NULL, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?')
    .run(request.params.id)
  audit('material', request.params.id, 'image_removed', {})
  response.json(db.prepare('SELECT * FROM materials WHERE id = ?').get(request.params.id))
})

apiRouter.get('/staff', (_request, response) => {
  response.json(db.prepare('SELECT * FROM staff ORDER BY name COLLATE NOCASE').all())
})

apiRouter.post('/staff', (request, response) => {
  const body = parseBody(staffSchema, request, response)
  if (!body) return
  const id = randomUUID()
  db.prepare('INSERT INTO staff (id, name, active) VALUES (?, ?, ?)')
    .run(id, body.name, body.active === false ? 0 : 1)
  audit('staff', id, 'created', body)
  response.status(201).json(db.prepare('SELECT * FROM staff WHERE id = ?').get(id))
})

apiRouter.patch('/staff/:id', (request, response) => {
  const body = parseBody(staffSchema.partial(), request, response)
  if (!body) return
  const existing = db.prepare('SELECT * FROM staff WHERE id = ?').get(request.params.id)
  if (!existing) {
    sendError(response, 404, 'Staff member not found')
    return
  }
  db.prepare(`
    UPDATE staff
    SET name = COALESCE(?, name),
        active = COALESCE(?, active),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(body.name ?? null, body.active === undefined ? null : body.active ? 1 : 0, request.params.id)
  audit('staff', request.params.id, 'updated', body)
  response.json(db.prepare('SELECT * FROM staff WHERE id = ?').get(request.params.id))
})

apiRouter.post('/sessions/:sessionId/distributions', (request, response) => {
  const body = parseBody(submissionSchema, request, response)
  if (!body) return
  body.name = normalizePersonName(body.name)
  const session = db.prepare(`
    SELECT sessions.*, staff.active AS distributor_active
    FROM sessions
    LEFT JOIN staff ON staff.id = sessions.distributor_staff_id
    WHERE sessions.id = ?
  `).get(request.params.sessionId) as
    | { id: string; status: string; distributor_staff_id: string | null; distributor_active: number | null }
    | undefined
  if (!session) {
    sendError(response, 404, 'Session not found')
    return
  }
  if (session.status !== 'active') {
    sendError(response, 409, 'This session is not active')
    return
  }
  if (!session.distributor_staff_id || session.distributor_active !== 1) {
    sendError(response, 409, 'This session has no active distributor')
    return
  }

  const distributionId = randomUUID()
  const patronId = randomUUID()
  const now = new Date().toISOString()
  const submission = db.transaction(() => {
    const insertPatron = db.prepare('INSERT INTO patrons (id, name, sex) VALUES (?, ?, ?)')
    insertPatron.run(patronId, body.name, body.sex)
    db.prepare(`
      INSERT INTO distributions (
        id, session_id, patron_id, distributed_at, distributed_by_staff_id
      ) VALUES (?, ?, ?, ?, ?)
    `).run(distributionId, session.id, patronId, now, session.distributor_staff_id)

    const insertEntry = db.prepare(`
      INSERT INTO distribution_entries (
        id, distribution_id, material_id, author_editor_snapshot,
        material_title_snapshot, quantity
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const entry of body.entries) {
      const material = db.prepare(`
        SELECT m.id, m.author_editor, m.title
        FROM session_materials sm
        JOIN materials m ON m.id = sm.material_id
        WHERE sm.session_id = ? AND sm.enabled = 1 AND m.active = 1 AND m.id = ?
      `).get(session.id, entry.materialId) as { id: string; author_editor: string; title: string | null } | undefined
      if (!material) {
        throw new Error('One or more selected materials are unavailable in this session')
      }
      insertEntry.run(
        randomUUID(),
        distributionId,
        material.id,
        material.author_editor,
        material.title ?? material.author_editor,
        entry.quantity,
      )
    }
    audit('distribution', distributionId, 'created', { patronId, entries: body.entries })
  })

  try {
    submission()
  } catch (error) {
    sendError(response, 400, error instanceof Error ? error.message : 'Could not record distribution')
    return
  }
  response.status(201).json({ id: distributionId })
})

apiRouter.get('/sessions/:sessionId/distributions', (request, response) => {
  const distributions = db.prepare(`
    SELECT d.*,
           p.name AS patron_name,
           p.sex AS patron_sex,
           s.name AS staff_name
    FROM distributions d
    JOIN patrons p ON p.id = d.patron_id
    LEFT JOIN staff s ON s.id = d.distributed_by_staff_id
    WHERE d.session_id = ?
    ORDER BY d.created_at DESC
  `).all(request.params.sessionId)

  const entriesStatement = db.prepare(`
    SELECT de.*, m.title AS material_title
    FROM distribution_entries de
    LEFT JOIN materials m ON m.id = de.material_id
    WHERE de.distribution_id = ?
  `)
  const detailed = (distributions as Array<Record<string, unknown>>).map((distribution) => ({
    ...distribution,
    entries: entriesStatement.all(distribution.id),
  }))
  response.json(detailed)
})

apiRouter.post('/distributions/:id/void', (request, response) => {
  const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) })
  const body = parseBody(reasonSchema, request, response)
  if (!body) return
  const existing = db.prepare('SELECT id, is_voided FROM distributions WHERE id = ?').get(request.params.id)
  if (!existing) {
    sendError(response, 404, 'Distribution not found')
    return
  }
  db.prepare(`
    UPDATE distributions
    SET is_voided = 1, void_reason = ?
    WHERE id = ?
  `).run(body.reason, request.params.id)
  audit('distribution', request.params.id, 'voided', body)
  response.json({ id: request.params.id, isVoided: true, voidReason: body.reason })
})

apiRouter.post('/distributions/:id/correct', (request, response) => {
  const body = parseBody(submissionSchema, request, response)
  if (!body) return
  body.name = normalizePersonName(body.name)
  const existing = db.prepare(`
    SELECT d.*, p.name AS patron_name, p.sex AS patron_sex
    FROM distributions d
    JOIN patrons p ON p.id = d.patron_id
    WHERE d.id = ?
  `).get(request.params.id) as Record<string, unknown> | undefined
  if (!existing) {
    sendError(response, 404, 'Distribution not found')
    return
  }

  const session = db.prepare(`
    SELECT sessions.distributor_staff_id, staff.active AS distributor_active
    FROM sessions
    LEFT JOIN staff ON staff.id = sessions.distributor_staff_id
    WHERE sessions.id = ?
  `).get(existing.session_id) as
    | { distributor_staff_id: string | null; distributor_active: number | null }
    | undefined
  if (!session?.distributor_staff_id || session.distributor_active !== 1) {
    sendError(response, 409, 'This session has no active distributor')
    return
  }

  const correctedId = randomUUID()
  const patronId = randomUUID()
  const now = new Date().toISOString()
  const correction = db.transaction(() => {
    db.prepare('UPDATE distributions SET is_voided = 1, void_reason = ? WHERE id = ?')
      .run('Superseded by corrected transaction', request.params.id)
    db.prepare('INSERT INTO patrons (id, name, sex) VALUES (?, ?, ?)').run(patronId, body.name, body.sex)
    db.prepare(`
      INSERT INTO distributions (
        id, session_id, patron_id, distributed_at, distributed_by_staff_id,
        corrected_by_distribution_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      correctedId,
      existing.session_id,
      patronId,
      now,
      session.distributor_staff_id,
      request.params.id,
    )
    const insertEntry = db.prepare(`
      INSERT INTO distribution_entries (
        id, distribution_id, material_id, author_editor_snapshot,
        material_title_snapshot, quantity
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const entry of body.entries) {
      const material = db.prepare(`
        SELECT m.id, m.author_editor, m.title
        FROM session_materials sm
        JOIN materials m ON m.id = sm.material_id
        WHERE sm.session_id = ? AND sm.enabled = 1 AND m.active = 1 AND m.id = ?
      `).get(existing.session_id, entry.materialId) as { id: string; author_editor: string; title: string | null } | undefined
      if (!material) throw new Error('One or more selected materials are unavailable in this session')
      insertEntry.run(
        randomUUID(),
        correctedId,
        material.id,
        material.author_editor,
        material.title ?? material.author_editor,
        entry.quantity,
      )
    }
    audit('distribution', request.params.id, 'corrected', { correctedId, ...body })
  })

  try {
    correction()
  } catch (error) {
    sendError(response, 400, error instanceof Error ? error.message : 'Could not correct distribution')
    return
  }
  response.status(201).json({ id: correctedId })
})

apiRouter.get('/dashboard/summary', (request, response) => {
  const dateFrom = typeof request.query.dateFrom === 'string' ? request.query.dateFrom : ''
  const dateTo = typeof request.query.dateTo === 'string' ? request.query.dateTo : ''
  const dateFilters: string[] = []
  const dateParams: string[] = []
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    dateFilters.push('AND substr(d.distributed_at, 1, 10) >= ?')
    dateParams.push(dateFrom)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    dateFilters.push('AND substr(d.distributed_at, 1, 10) <= ?')
    dateParams.push(dateTo)
  }
  const dateFilter = dateFilters.join(' ')

  const sessions = db.prepare(`
    SELECT s.*, st.name AS distributor_name
    FROM sessions s
    LEFT JOIN staff st ON st.id = s.distributor_staff_id
    ORDER BY s.created_at DESC
  `).all() as Array<Record<string, unknown>>

  const activeSession = sessions.find((session) => session.status === 'active')
  const requestedId = typeof request.query.sessionId === 'string' ? request.query.sessionId : ''
  const selectedSession = requestedId
    ? sessions.find((session) => session.id === requestedId) ?? activeSession ?? sessions[0]
    : activeSession ?? sessions[0]

  function scopedSummary(sessionId?: string) {
    const params: unknown[] = sessionId ? [sessionId] : []
    params.push(...dateParams)
    const sessionFilter = sessionId ? 'AND d.session_id = ?' : ''
    const base = db.prepare(`
      SELECT
        COALESCE(SUM(de.quantity), 0) AS copies,
        COUNT(DISTINCT d.id) AS transactions,
        COUNT(DISTINCT COALESCE(de.material_id, de.author_editor_snapshot)) AS distinct_materials
      FROM distributions d
      JOIN distribution_entries de ON de.distribution_id = d.id
      WHERE d.is_voided = 0 ${sessionFilter} ${dateFilter}
    `).get(...params) as { copies: number; transactions: number; distinct_materials: number }

    const patrons = db.prepare(`
      SELECT p.sex,
             COUNT(DISTINCT lower(trim(p.name)) || '|' || lower(trim(p.sex))) AS count
      FROM distributions d
      JOIN patrons p ON p.id = d.patron_id
      WHERE d.is_voided = 0 ${sessionFilter} ${dateFilter}
      GROUP BY p.sex
    `).all(...params) as Array<{ sex: string; count: number }>

    const male = Number(patrons.find((row) => row.sex === 'Male')?.count ?? 0)
    const female = Number(patrons.find((row) => row.sex === 'Female')?.count ?? 0)
    const totalPatrons = Number(patrons.reduce((sum, row) => sum + Number(row.count), 0))
    const knownSexTotal = male + female
    const copies = Number(base.copies)

    return {
      copies,
      transactions: Number(base.transactions),
      distinctMaterials: Number(base.distinct_materials),
      patrons: totalPatrons,
      male,
      female,
      malePercentage: knownSexTotal ? male / knownSexTotal * 100 : 0,
      femalePercentage: knownSexTotal ? female / knownSexTotal * 100 : 0,
      averageCopiesPerPatron: totalPatrons ? copies / totalPatrons : 0,
      denominatorNote: 'Percentages use patrons with recorded Male or Female sex.',
    }
  }

  const overall = { ...scopedSummary(), sessions: sessions.length }
  const exhibit = selectedSession
    ? { ...scopedSummary(String(selectedSession.id)), session: selectedSession }
    : null

  const exhibitParams = selectedSession ? [selectedSession.id] : []
  const exhibitFilter = selectedSession ? 'AND d.session_id = ?' : ''
  exhibitParams.push(...dateParams)

  const trend = db.prepare(`
    SELECT substr(d.distributed_at, 1, 10) AS date, SUM(de.quantity) AS copies
    FROM distributions d
    JOIN distribution_entries de ON de.distribution_id = d.id
    WHERE d.is_voided = 0 ${exhibitFilter} ${dateFilter}
    GROUP BY substr(d.distributed_at, 1, 10)
    ORDER BY date ASC
  `).all(...exhibitParams) as Array<{ date: string; copies: number }>

  const materials = db.prepare(`
    SELECT COALESCE(de.material_title_snapshot, m.title, de.author_editor_snapshot) AS name,
           m.image_path AS imagePath,
           SUM(de.quantity) AS copies
    FROM distributions d
    JOIN distribution_entries de ON de.distribution_id = d.id
    LEFT JOIN materials m ON m.id = de.material_id
    WHERE d.is_voided = 0 ${exhibitFilter} ${dateFilter}
    GROUP BY COALESCE(de.material_title_snapshot, m.title, de.author_editor_snapshot), m.image_path
    ORDER BY copies DESC
    LIMIT 10
  `).all(...exhibitParams) as Array<{ name: string; imagePath: string | null; copies: number }>

  const staff = db.prepare(`
    SELECT COALESCE(st.name, 'Unknown') AS name,
           COUNT(DISTINCT d.id) AS transactions,
           SUM(de.quantity) AS copies
    FROM distributions d
    JOIN distribution_entries de ON de.distribution_id = d.id
    LEFT JOIN staff st ON st.id = d.distributed_by_staff_id
    WHERE d.is_voided = 0 ${exhibitFilter} ${dateFilter}
    GROUP BY st.id, st.name
    ORDER BY transactions DESC, copies DESC
  `).all(...exhibitParams) as Array<{ name: string; transactions: number; copies: number }>

  const sessionVolume = db.prepare(`
    SELECT s.id, s.name, s.status,
           COUNT(DISTINCT d.id) AS transactions,
           COALESCE(SUM(de.quantity), 0) AS copies
    FROM sessions s
    LEFT JOIN distributions d ON d.session_id = s.id AND d.is_voided = 0
    LEFT JOIN distribution_entries de ON de.distribution_id = d.id
    GROUP BY s.id, s.name, s.status
    ORDER BY s.created_at DESC
  `).all() as Array<{ id: string; name: string; status: string; transactions: number; copies: number }>

  const recent = db.prepare(`
    SELECT d.id, d.distributed_at,
           p.name AS patronName, p.sex AS patronSex,
           st.name AS distributedBy,
           COALESCE(de.material_title_snapshot, m.title, de.author_editor_snapshot) AS iecTitle,
           de.quantity
    FROM distributions d
    JOIN patrons p ON p.id = d.patron_id
    JOIN distribution_entries de ON de.distribution_id = d.id
    LEFT JOIN staff st ON st.id = d.distributed_by_staff_id
    LEFT JOIN materials m ON m.id = de.material_id
    WHERE d.is_voided = 0 ${exhibitFilter} ${dateFilter}
    ORDER BY d.distributed_at DESC
    LIMIT 12
  `).all(...exhibitParams)

  const latest = selectedSession
    ? db.prepare(`
        SELECT distributed_at
        FROM distributions
        WHERE is_voided = 0 AND session_id = ?
          ${dateFilter.replaceAll('d.distributed_at', 'distributed_at')}
        ORDER BY distributed_at DESC
        LIMIT 1
      `).get(selectedSession.id, ...dateParams) as { distributed_at: string } | undefined
    : undefined

  response.json({
    overall,
    exhibit,
    sessions,
    trend,
    materials,
    staff,
    sessionVolume,
    recent,
    latestSessionActivity: latest?.distributed_at ?? null,
  })
})

apiRouter.get('/sessions/:sessionId/export', async (request, response) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(request.params.sessionId) as
    | { id: string; name: string }
    | undefined
  if (!session) {
    sendError(response, 404, 'Session not found')
    return
  }

  const rows = db.prepare(`
    SELECT d.distributed_at,
           p.name AS patron_name,
           p.sex AS patron_sex,
           COALESCE(de.material_title_snapshot, m.title, de.author_editor_snapshot) AS iec_title,
           de.quantity,
           s.name AS staff_name
    FROM distributions d
    JOIN patrons p ON p.id = d.patron_id
    JOIN distribution_entries de ON de.distribution_id = d.id
    LEFT JOIN materials m ON m.id = de.material_id
    LEFT JOIN staff s ON s.id = d.distributed_by_staff_id
    WHERE d.session_id = ? AND d.is_voided = 0
    ORDER BY d.distributed_at ASC, p.name COLLATE NOCASE ASC
  `).all(session.id)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'IDEA'
  workbook.created = new Date()
  const worksheet = workbook.addWorksheet('Distribution')
  worksheet.addRow(['EVENT INFORMATION', 'PATRON INFORMATION', 'PATRON INFORMATION', 'IEC INFORMATION', 'IEC INFORMATION', 'IEC INFORMATION'])
  worksheet.mergeCells('A1:A2')
  worksheet.mergeCells('B1:C1')
  worksheet.mergeCells('D1:F1')
  worksheet.addRow(['Date Distributed', 'Name', 'Sex', 'Author / Editor', 'No. of Physical Copies Distributed', 'Distributed By'])

  for (const row of rows as Array<Record<string, unknown>>) {
    const date = new Date(String(row.distributed_at))
    worksheet.addRow([
      Number.isNaN(date.getTime()) ? row.distributed_at : date,
      row.patron_name,
      row.patron_sex,
      row.iec_title,
      row.quantity,
      row.staff_name ?? '',
    ])
  }

  worksheet.getRow(1).font = { bold: true }
  worksheet.getRow(2).font = { bold: true }
  worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  worksheet.getRow(2).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  worksheet.columns = [
    { width: 20 },
    { width: 28 },
    { width: 18 },
    { width: 36 },
    { width: 34 },
    { width: 24 },
  ]
  worksheet.getColumn(1).numFmt = 'yyyy-mm-dd hh:mm'
  worksheet.autoFilter = 'A2:F2'
  worksheet.views = [{ state: 'frozen', ySplit: 2 }]

  response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  response.setHeader('Content-Disposition', `attachment; filename="IDEA-${session.name.replace(/[^a-z0-9]+/gi, '-')}.xlsx"`)
  await workbook.xlsx.write(response)
  response.end()
})
