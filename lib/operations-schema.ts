export const operationsSchema = [
  `CREATE TABLE IF NOT EXISTS classroom_profiles (classroom_id TEXT PRIMARY KEY REFERENCES classrooms(id) ON DELETE CASCADE, school_name TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS participant_presence (actor_key TEXT PRIMARY KEY, role TEXT NOT NULL, actor_id TEXT NOT NULL, classroom_id TEXT, seen_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS participant_presence_recent ON participant_presence(seen_at)`,
  `CREATE TABLE IF NOT EXISTS operations_settings (id TEXT PRIMARY KEY, value_json TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS print_uploads (id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL REFERENCES teachers(id), classroom_id TEXT NOT NULL REFERENCES classrooms(id), environment TEXT NOT NULL, title TEXT NOT NULL, layout_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'uploading', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS print_requests (id TEXT PRIMARY KEY, teacher_id TEXT NOT NULL REFERENCES teachers(id), classroom_id TEXT NOT NULL REFERENCES classrooms(id), environment TEXT NOT NULL, document_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested', provider_json TEXT, error TEXT, lease TEXT, lease_at INTEGER, order_started_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE INDEX IF NOT EXISTS print_requests_teacher ON print_requests(teacher_id, classroom_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS print_request_items (id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES print_requests(id) ON DELETE CASCADE, document_json TEXT NOT NULL, book_uid TEXT, remote_started_at INTEGER, ready INTEGER NOT NULL DEFAULT 0)`,
];
