// Seed Murmur's local SQLite with realistic demo data for a user.
// Usage:  node --env-file=.env scripts/seed.mjs --user harsh
//                              (defaults to env MURMUR_USER and MURMUR_DB)
//
// Connects to the *same* database the dev server uses (MURMUR_DB) and
// writes a handful of contacts + notes under the user's JWT `sub`.
// In the recording, we won't run this against a live JWT — we'll just
// find a sub from a prior E2E run and seed under that sub.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import process from "node:process";

const dbPath = process.env.MURMUR_DB ?? "murmur.db";
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
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

const id = () => crypto.randomUUID();
const minutesAgo = (m) => Date.now() - m * 60 * 1000;
const daysAgo = (d) => Date.now() - d * 24 * 60 * 60 * 1000;

const seed = (userKey) => {
  // Clear existing data for this user (idempotent re-seed)
  db.prepare("DELETE FROM notes WHERE user_key = ?").run(userKey);
  db.prepare("DELETE FROM contacts WHERE user_key = ?").run(userKey);

  const contacts = [
    {
      name: "Sam Lee",
      context: "Met at the AuthPlane × Skybridge conference, working on agent identity",
      notes: [
        "His daughter just started college. Send him a congrats text next week.",
        "OIDC federation is the topic for his new blog post.",
        "Wants to set up a shared playground for the XAA spec — we should follow up next week.",
        "Recommended 'OAuth 2.1 in Practice' — said chapter 4 is the most useful for our work.",
      ],
      spacing: [8, 35, 240, 60 * 24 * 2], // 8m, 35m, 4h, 2d ago
    },
    {
      name: "Riley Park",
      context: "Recruiter at Alpic, helped set up the speedrun office hours",
      notes: [
        "Sent over the Skybridge devtools intro deck — worth sharing with the team.",
        "Coffee chat scheduled for Thursday at 3pm PT — bring the auth demo.",
      ],
      spacing: [60 * 6, 60 * 22], // 6h, 22h ago
    },
    {
      name: "Maya Singh",
      context: "Open-source maintainer we paired with on the MCP auth challenge",
      notes: [
        "Confirmed the per-user isolation works on her second account — perfect for the isolation demo.",
        "Suggested adding an aggregate view ('show all contacts touched in the last week') as a stretch goal.",
        "She wants to try Murmur with her own team next week.",
      ],
      spacing: [60 * 26, 60 * 24 * 3, 60 * 24 * 5], // 26h, 3d, 5d ago
    },
    {
      name: "Harsh",
      context: "Me — testing my own app",
      notes: [
        "Setup notes: WSL2 Ubuntu 24 + Docker Desktop + Node 24.19 portable + Alpic tunnel.",
        "Day 1 green: AS up, e2e script 14/14, isolation proven in SQLite.",
        "Day 2 green: 6 tools, 5 views, record-ready.",
        "Day 2 evening: views polished, USPs written, money note added.",
      ],
      spacing: [60 * 30, 60 * 24, 60 * 24 * 2, 30], // 30m, 1d, 2d, 30s ago
    },
  ];

  for (const c of contacts) {
    const cid = id();
    db.prepare("INSERT INTO contacts (id, user_key, name, context, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(cid, userKey, c.name, c.context, minutesAgo(60 * 24 * 7)); // created a week ago
    for (let i = 0; i < c.notes.length; i++) {
      db.prepare("INSERT INTO notes (id, user_key, contact_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id(), userKey, cid, c.notes[i], minutesAgo(c.spacing[i]));
    }
  }
  console.log(`Seeded ${contacts.length} contacts with ${contacts.reduce((n, c) => n + c.notes.length, 0)} notes for user_key=${userKey}`);
};

const userKey = process.argv[2] ?? process.env.MURMUR_USER_KEY;
if (!userKey) {
  console.error("Usage: node scripts/seed.mjs <user_key>");
  console.error("Or set MURMUR_USER_KEY env var.");
  process.exit(1);
}
seed(userKey);
db.close();
