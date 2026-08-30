// Murmur — Personal CRM MCP App.
// Built with Skybridge, secured by AuthPlane.
//
// Wiring follows the canonical authplaneProvider one-liner from
// https://docs.skybridge.tech/api-reference/authplane-provider.

import { McpServer, authplaneProvider } from "skybridge/server";
import { z } from "zod";
import {
  addContact as dbAddContact,
  addNote as dbAddNote,
  searchContacts as dbSearch,
  listRecent as dbListRecent,
  listNotes as dbListNotes,
  getContact as dbGetContact,
  deleteContact as dbDeleteContact,
} from "./store.js";

const ISSUER = (process.env.AUTHPLANE_ISSUER ?? "").trim();
const RESOURCE = (process.env.SERVER_URL ?? "").trim();

if (!ISSUER) throw new Error("AUTHPLANE_ISSUER is required");
if (!RESOURCE) throw new Error("SERVER_URL is required");

type MurmurClaims = { subject?: string };

const subjectOf = (extra: any): string =>
  extra?.authInfo?.extra?.subject ?? "anonymous";

const server = new McpServer(
  { name: "murmur", version: "0.1.0" },
  { capabilities: {} },
  {
    oauth: await authplaneProvider<MurmurClaims>({
      issuer: ISSUER,
      resource: RESOURCE,
      scopes: ["contacts:read", "contacts:write"],
    }),
  },
)
  .registerTool(
    {
      name: "who-am-i",
      title: "Who am I?",
      description:
        "Return the verified identity of the caller from the AuthPlane-issued JWT. " +
        "Use this to confirm a user is signed in and to show the granted scopes on screen.",
      inputSchema: {},
      outputSchema: {
        subject: z.string(),
        clientId: z.string().optional(),
        scopes: z.array(z.string()).optional(),
        expiresAt: z.number().optional(),
        resource: z.string().optional(),
        issuer: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { "openai/widgetAccessible": true },
      view: { component: "identity" },
    },
    async (_input, extra) => {
      const info = extra.authInfo;
      return {
        content: `Signed in as user ${info?.extra?.subject ?? "unknown"} via OAuth client ${
          info?.clientId ?? "unknown"
        }. Verified by AuthPlane.`,
        structuredContent: {
          subject: info?.extra?.subject ?? "unknown",
          clientId: info?.clientId,
          scopes: info?.scopes,
          expiresAt: info?.expiresAt,
          resource: RESOURCE,
          issuer: ISSUER,
        },
      };
    },
  )
  .registerTool(
    {
      name: "add-contact",
      title: "Add a contact",
      description:
        "Create a new contact (a person) in the caller's private CRM. " +
        "Returns the contact profile with an empty notes list, and renders " +
        "the contact card view with a quick-add note composer.",
      inputSchema: {
        name: z.string().describe("Full name of the person"),
        context: z
          .string()
          .optional()
          .describe("One-line context, e.g. 'met at the conference, working on agent identity'"),
      },
      outputSchema: {
        contact: z.object({
          id: z.string(),
          name: z.string(),
          context: z.string().nullable(),
          createdAt: z.number(),
        }),
        recentNotes: z.array(z.any()),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: {
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Saving the contact…",
        "openai/toolInvocation/invoked": "Contact saved.",
      },
      view: { component: "contact-card" },
    },
    async ({ name, context }, extra) => {
      const userKey = subjectOf(extra);
      const c = dbAddContact(userKey, name, context);
      return {
        content: `Added "${c.name}"${c.context ? ` — ${c.context}` : ""}.`,
        structuredContent: {
          contact: { id: c.id, name: c.name, context: c.context, createdAt: c.created_at },
          recentNotes: [],
        },
      };
    },
  )
  .registerTool(
    {
      name: "add-note",
      title: "Add a note",
      description:
        "Append a note to an existing contact. Returns the refreshed contact card.",
      inputSchema: {
        contactId: z.string().describe("The contact's id"),
        body: z.string().describe("The note text"),
      },
      outputSchema: {
        contact: z.object({
          id: z.string(),
          name: z.string(),
          context: z.string().nullable(),
          createdAt: z.number(),
        }),
        note: z.object({ id: z.string(), body: z.string(), createdAt: z.number() }),
        recentNotes: z.array(z.any()),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: {
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Saving the note…",
        "openai/toolInvocation/invoked": "Note saved.",
      },
      view: { component: "note-result" },
    },
    async ({ contactId, body }, extra) => {
      const userKey = subjectOf(extra);
      const contact = dbGetContact(userKey, contactId);
      if (!contact) {
        return {
          content: `Contact not found.`,
          structuredContent: { contact: { id: "", name: "", context: null, createdAt: 0 }, note: { id: "", body: "", createdAt: 0 }, recentNotes: [] },
          isError: true,
        };
      }
      const note = dbAddNote(userKey, contactId, body);
      const allNotes = dbListNotes(userKey, contactId, 20);
      return {
        content: `Noted on ${contact.name}.`,
        structuredContent: {
          contact: { id: contact.id, name: contact.name, context: contact.context, createdAt: contact.created_at },
          note: { id: note.id, body: note.body, createdAt: note.created_at },
          recentNotes: allNotes.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at })),
        },
      };
    },
  )
  .registerTool(
    {
      name: "search-contacts",
      title: "Search contacts",
      description: "Free-text search over the caller's contacts.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10"),
      },
      outputSchema: {
        matches: z.array(z.object({
          contact: z.object({ id: z.string(), name: z.string(), context: z.string().nullable() }),
          lastNote: z.any().nullable(),
          score: z.number(),
          matchedField: z.string(),
        })),
        total: z.number(),
        query: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Searching…", "openai/toolInvocation/invoked": "Search complete." },
      view: { component: "search-results" },
    },
    async ({ query, limit }, extra) => {
      const userKey = subjectOf(extra);
      const hits = dbSearch(userKey, query, limit ?? 10);
      return {
        content: hits.length === 0 ? `No contacts matched "${query}".` : `Found ${hits.length} contact${hits.length === 1 ? "" : "s"} for "${query}".`,
        structuredContent: {
          matches: hits.map((h) => ({
            contact: { id: h.contact.id, name: h.contact.name, context: h.contact.context },
            lastNote: h.lastNote ? { id: h.lastNote.id, body: h.lastNote.body, createdAt: h.lastNote.created_at } : null,
            score: h.score,
            matchedField: h.matchedField,
          })),
          total: hits.length,
          query,
        },
      };
    },
  )
  .registerTool(
    {
      name: "list-recent",
      title: "Recent contacts",
      description: "The caller's most-recently-touched contacts.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
      },
      outputSchema: {
        items: z.array(z.object({
          contact: z.object({ id: z.string(), name: z.string(), context: z.string().nullable() }),
          lastNote: z.any().nullable(),
          lastContactedAt: z.number(),
        })),
        total: z.number(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Loading recent contacts…", "openai/toolInvocation/invoked": "Loaded." },
      view: { component: "recent-dashboard" },
    },
    async ({ limit }, extra) => {
      const userKey = subjectOf(extra);
      const items = dbListRecent(userKey, limit ?? 10);
      return {
        content: items.length === 0 ? `No contacts yet.` : `Your ${items.length} most recent contact${items.length === 1 ? "" : "s"}.`,
        structuredContent: {
          items: items.map((it) => ({
            contact: { id: it.contact.id, name: it.contact.name, context: it.contact.context },
            lastNote: it.lastNote ? { id: it.lastNote.id, body: it.lastNote.body, createdAt: it.lastNote.created_at } : null,
            lastContactedAt: it.lastContactedAt,
          })),
          total: items.length,
        },
      };
    },
  )
  // 6. delete-contact -------------------------------------------------------
  .registerTool(
    {
      name: "delete-contact",
      title: "Delete a contact",
      description:
        "Permanently delete a contact and all their notes from the caller's CRM. " +
        "This cannot be undone. The framework will show a confirmation prompt " +
        "before invoking (destructiveHint: true).",
      inputSchema: {
        contactId: z.string().describe("The contact's id"),
      },
      outputSchema: {
        deleted: z.boolean(),
        name: z.string(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
      _meta: {
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Deleting the contact…",
        "openai/toolInvocation/invoked": "Contact deleted.",
      },
      view: { component: "delete-result" },
    },
    async ({ contactId }, extra) => {
      const userKey = subjectOf(extra);
      const contact = dbGetContact(userKey, contactId);
      if (!contact) {
        return {
          content: `Contact not found.`,
          structuredContent: { deleted: false, name: "" },
          isError: true,
        };
      }
      const name = contact.name;
      dbDeleteContact(userKey, contactId);
      return {
        content: `Deleted "${name}" and all their notes.`,
        structuredContent: { deleted: true, name },
      };
    },
  );

server.run();
export type AppType = typeof server;
