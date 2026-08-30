// Seed a *different* set of contacts for the second demo user.
// Used to make the isolation demo visually obvious: harsh has 4
// contacts, maya has 0 — so the same query in two accounts returns
// different results.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import process from "node:process";

const dbPath = process.env.MURMUR_DB ?? "murmur.db";
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");

const id = () => crypto.randomUUID();
const minutesAgo = (m) => Date.now() - m * 60 * 1000;

const userKey = process.argv[2];
if (!userKey) { console.error("Usage: node scripts/seed-maya.mjs <user_key>"); process.exit(1); }

db.prepare("DELETE FROM notes WHERE user_key = ?").run(userKey);
db.prepare("DELETE FROM contacts WHERE user_key = ?").run(userKey);

// Intentionally empty so the isolation demo is visually clean:
// same prompt, two accounts, two different results.
console.log(`Maya's ledger left empty (for isolation demo).`);

db.close();
