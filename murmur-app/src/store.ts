// Murmur — node:sqlite store.
// Two tables, keyed by JWT `sub` (the only auth we have). No user DB.
// Tables are created lazily on first access.

import { DatabaseSync } from "node:sqlite";

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  const d = new DatabaseSync(process.env.MURMUR_DB ?? "murmur.db");
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA foreign_keys = ON;");
  d.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id          TEXT PRIMARY KEY,
      user_key    TEXT NOT NULL,
      name        TEXT NOT NULL,
      context     TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_key);

    CREATE TABLE IF NOT EXISTS notes (
      id          TEXT PRIMARY KEY,
      user_key    TEXT NOT NULL,
      contact_id  TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_user_contact ON notes(user_key, contact_id, created_at DESC);
  `);
  _db = d;
  return d;
}

export type Contact = {
  id: string;
  user_key: string;
  name: string;
  context: string | null;
  created_at: number;
};

export type Note = {
  id: string;
  user_key: string;
  contact_id: string;
  body: string;
  created_at: number;
};

const id = () => crypto.randomUUID();

export function addContact(userKey: string, name: string, context?: string): Contact {
  const c: Contact = { id: id(), user_key: userKey, name, context: context ?? null, created_at: Date.now() };
  db().prepare(
    "INSERT INTO contacts (id, user_key, name, context, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(c.id, c.user_key, c.name, c.context, c.created_at);
  return c;
}

export function getContact(userKey: string, contactId: string): Contact | null {
  const row = db()
    .prepare("SELECT * FROM contacts WHERE id = ? AND user_key = ?")
    .get(contactId, userKey) as Contact | undefined;
  return row ?? null;
}

export function addNote(userKey: string, contactId: string, body: string): Note {
  const owner = getContact(userKey, contactId);
  if (!owner) throw new Error("contact not found");
  const n: Note = { id: id(), user_key: userKey, contact_id: contactId, body, created_at: Date.now() };
  db().prepare(
    "INSERT INTO notes (id, user_key, contact_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(n.id, n.user_key, n.contact_id, n.body, n.created_at);
  return n;
}

export function deleteContact(userKey: string, contactId: string): boolean {
  const result = db()
    .prepare("DELETE FROM contacts WHERE id = ? AND user_key = ?")
    .run(contactId, userKey);
  return result.changes > 0;
}

export function listNotes(userKey: string, contactId: string, limit = 20): Note[] {
  return db()
    .prepare(
      "SELECT * FROM notes WHERE user_key = ? AND contact_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(userKey, contactId, limit) as Note[];
}

export type RecentItem = {
  contact: Contact;
  lastNote: Note | null;
  lastContactedAt: number;
};

export function listRecent(userKey: string, limit = 10): RecentItem[] {
  const rows = db()
    .prepare(
      `
      SELECT c.id AS c_id, c.user_key AS c_user_key, c.name AS c_name, c.context AS c_context, c.created_at AS c_created_at,
             n.id AS n_id, n.body AS n_body, n.created_at AS n_created_at
      FROM contacts c
      LEFT JOIN notes n ON n.contact_id = c.id AND n.user_key = c.user_key
        AND n.id = (
          SELECT n2.id FROM notes n2
          WHERE n2.contact_id = c.id AND n2.user_key = c.user_key
          ORDER BY n2.created_at DESC LIMIT 1
        )
      WHERE c.user_key = ?
      ORDER BY COALESCE(n.created_at, c.created_at) DESC
      LIMIT ?
    `,
    )
    .all(userKey, limit) as Array<{
      c_id: string; c_user_key: string; c_name: string; c_context: string | null; c_created_at: number;
      n_id?: string; n_body?: string; n_created_at?: number;
    }>;
  return rows.map((r) => ({
    contact: { id: r.c_id, user_key: r.c_user_key, name: r.c_name, context: r.c_context, created_at: r.c_created_at },
    lastNote: r.n_id
      ? { id: r.n_id, user_key: r.c_user_key, contact_id: r.c_id, body: r.n_body!, created_at: r.n_created_at! }
      : null,
    lastContactedAt: r.n_created_at ?? r.c_created_at,
  }));
}

export type SearchHit = {
  contact: Contact;
  lastNote: Note | null;
  score: number;
  matchedField: "name" | "context" | "note";
};

export function searchContacts(userKey: string, query: string, limit = 10): SearchHit[] {
  const like = `%${query.replace(/[%_]/g, (m) => "\\" + m)}%`;
  const rows = db()
    .prepare(
      `
      SELECT c.id AS c_id, c.user_key AS c_user_key, c.name AS c_name, c.context AS c_context, c.created_at AS c_created_at,
             n.id AS n_id, n.body AS n_body, n.created_at AS n_created_at,
             (CASE WHEN c.name LIKE ? ESCAPE '\\' THEN 3 ELSE 0 END
             + CASE WHEN c.context LIKE ? ESCAPE '\\' THEN 2 ELSE 0 END
             + CASE WHEN n.body LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END) AS score,
             (CASE
                WHEN c.name LIKE ? ESCAPE '\\' THEN 'name'
                WHEN c.context LIKE ? ESCAPE '\\' THEN 'context'
                ELSE 'note'
              END) AS matched_field
      FROM contacts c
      LEFT JOIN notes n ON n.contact_id = c.id AND n.user_key = c.user_key
        AND n.id = (
          SELECT n2.id FROM notes n2
          WHERE n2.contact_id = c.id AND n2.user_key = c.user_key
          ORDER BY n2.created_at DESC LIMIT 1
        )
      WHERE c.user_key = ?
        AND (c.name LIKE ? ESCAPE '\\' OR c.context LIKE ? ESCAPE '\\' OR n.body LIKE ? ESCAPE '\\')
      GROUP BY c.id
      ORDER BY score DESC, COALESCE(n.created_at, c.created_at) DESC
      LIMIT ?
    `,
    )
    .all(
      like, like, like,
      like, like,
      userKey,
      like, like, like,
      limit,
    ) as Array<{
      c_id: string; c_user_key: string; c_name: string; c_context: string | null; c_created_at: number;
      n_id?: string; n_body?: string; n_created_at?: number;
      score: number; matched_field: "name" | "context" | "note";
    }>;
  return rows.map((r) => ({
    contact: { id: r.c_id, user_key: r.c_user_key, name: r.c_name, context: r.c_context, created_at: r.c_created_at },
    lastNote: r.n_id
      ? { id: r.n_id, user_key: r.c_user_key, contact_id: r.c_id, body: r.n_body!, created_at: r.n_created_at! }
      : null,
    score: r.score,
    matchedField: r.matched_field,
  }));
}
