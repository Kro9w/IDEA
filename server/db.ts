import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.IDEA_DATA_DIR ?? 'data', 'idea.sqlite3')

mkdirSync(dirname(databasePath), { recursive: true })

export const db: Database.Database = new Database(databasePath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    details TEXT,
    location_region TEXT,
    location_province TEXT,
    location_city TEXT,
    location_details TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'completed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    title TEXT,
    author_editor TEXT NOT NULL,
    identifying_details TEXT,
    image_path TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS session_materials (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    requires_social_checklist INTEGER NOT NULL DEFAULT 0 CHECK (requires_social_checklist IN (0, 1)),
    PRIMARY KEY (session_id, material_id)
  );

  CREATE TABLE IF NOT EXISTS patrons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sex TEXT NOT NULL,
    age_range TEXT,
    region TEXT,
    province TEXT,
    city TEXT,
    sector TEXT,
    purpose TEXT,
    privacy_notice_accepted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS distributions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
    patron_id TEXT NOT NULL REFERENCES patrons(id) ON DELETE RESTRICT,
    distributed_at TEXT NOT NULL,
    distributed_by_staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT,
    is_voided INTEGER NOT NULL DEFAULT 0 CHECK (is_voided IN (0, 1)),
    void_reason TEXT,
    corrected_by_distribution_id TEXT REFERENCES distributions(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS distribution_entries (
    id TEXT PRIMARY KEY,
    distribution_id TEXT NOT NULL REFERENCES distributions(id) ON DELETE CASCADE,
    material_id TEXT REFERENCES materials(id) ON DELETE RESTRICT,
    author_editor_snapshot TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    changes_json TEXT,
    actor TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_distributions_session ON distributions(session_id);
  CREATE INDEX IF NOT EXISTS idx_distributions_patron ON distributions(patron_id);
  CREATE INDEX IF NOT EXISTS idx_distribution_entries_distribution
    ON distribution_entries(distribution_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_entity
    ON audit_log(entity_type, entity_id);
`)

const entryColumns = db.prepare('PRAGMA table_info(distribution_entries)').all() as Array<{ name: string }>
if (!entryColumns.some((column) => column.name === 'material_title_snapshot')) {
  db.exec('ALTER TABLE distribution_entries ADD COLUMN material_title_snapshot TEXT')
  db.exec(`
    UPDATE distribution_entries
    SET material_title_snapshot = COALESCE(
      (SELECT title FROM materials WHERE materials.id = distribution_entries.material_id),
      author_editor_snapshot
    )
  `)
}

const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
if (!sessionColumns.some((column) => column.name === 'distributor_staff_id')) {
  db.exec('ALTER TABLE sessions ADD COLUMN distributor_staff_id TEXT REFERENCES staff(id) ON DELETE RESTRICT')
}
for (const [name, type] of [['location_region', 'TEXT'], ['location_province', 'TEXT'], ['location_city', 'TEXT'], ['location_details', 'TEXT']] as const) {
  if (!sessionColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`)
  }
}

const sessionMaterialColumns = db.prepare('PRAGMA table_info(session_materials)').all() as Array<{ name: string }>
if (!sessionMaterialColumns.some((column) => column.name === 'stock_quantity')) {
  db.exec('ALTER TABLE session_materials ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 999999')
}

const patronColumns = db.prepare('PRAGMA table_info(patrons)').all() as Array<{ name: string }>
for (const [name, type] of [['age_range', 'TEXT'], ['region', 'TEXT'], ['province', 'TEXT'], ['city', 'TEXT'], ['sector', 'TEXT'], ['purpose', 'TEXT'], ['privacy_notice_accepted_at', 'TEXT']] as const) {
  if (!patronColumns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE patrons ADD COLUMN ${name} ${type}`)
  }
}
if (!sessionMaterialColumns.some((column) => column.name === 'visitor_limit')) {
  db.exec('ALTER TABLE session_materials ADD COLUMN visitor_limit INTEGER NOT NULL DEFAULT 999')
}
if (!sessionMaterialColumns.some((column) => column.name === 'requires_social_checklist')) {
  db.exec('ALTER TABLE session_materials ADD COLUMN requires_social_checklist INTEGER NOT NULL DEFAULT 0')
}
