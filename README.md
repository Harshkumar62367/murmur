# Murmur — Personal CRM MCP App

[![AuthPlane](https://img.shields.io/badge/OAuth-2.1-blue)](https://authplane.ai)
[![Skybridge](https://img.shields.io/badge/MCP_Apps-Skybridge-green)](https://skybridge.tech)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-2025--11--25-orange)](https://modelcontextprotocol.io)
[![Self--hosted](https://img.shields.io/badge/Self--hosted-identity-purple)](https://github.com/AuthPlane/authserver)

Your second brain, in your chat. Ask Claude (or ChatGPT) to remember a
person, what you talked about, and what to follow up on — and the note
is there the next time you ask. Every contact is private to the signed-in
user; isolation comes from the OAuth token AuthPlane mints, not from
application code.

Built with [Skybridge](https://skybridge.tech) and [AuthPlane](https://authplane.ai).
Submitted to the **AuthPlane × Skybridge Speedrun Challenge**.

## Demo prompts

- *"Add Sam Lee — met at the conference, working on agent identity."*
- *"We talked about OIDC federation and his new blog post."*
- *"What did I say about Sam?"* → contact card.
- *"What was I working on this week?"* → recent-dashboard view.
- *"Who am I?"* → verified JWT claims on screen.

## Why Murmur

- **Self-hosted identity for MCP apps.** AuthPlane runs in your Docker
  container. Your tokens, your keys, your AS. No third-party auth vendor.
- **One-line integration.** `authplaneProvider({ issuer, resource, scopes })`
  is the whole OAuth layer — discovery, JWKS verification, scope
  enforcement, DCR. Three strings to set, one constructor option.
- **The identity card is the demo.** Ask the model "who am I?" and the
  actual JWT claims appear in the chat — subject, client_id, scopes,
  expiry, resource. The auth *is* the product.

## Architecture

```
Host (Claude / ChatGPT) ─── HTTPS, streamable HTTP, Bearer JWT ───▶  Murmur (Skybridge, Node 24)
   DCR client                                                       authplaneProvider({ issuer, resource, scopes })
   PKCE-S256 + ES256                                                6 tools · 6 views · node:sqlite (keyed by JWT sub)
                                                                       │
                                                                       │   discovery, register, authorize, token, jwks
                                                                       ▼
                                                              AuthPlane (Docker: authplane/authserver:latest)
                                                                 :9000 public OAuth · :9001 admin API
                                                                 Resources + scopes + users · ES256 keys · SQLite
```

The advertised PRM `resource` = the registered resource `uri` = the
JWT `aud` — all three must match byte-for-byte. Drift = 401.

## Repo layout

```
murmur/
├── README.md
├── docker-compose.yml          AuthPlane only (the app runs natively)
├── .env.example
├── start.sh / start.ps1        Bring up AuthPlane + create demo users
├── stop.sh                     docker compose down
├── reset.sh                    Wipe volumes + database
├── scripts/
│   ├── e2e-oauth.mjs           Headless OAuth 2.1 E2E (PRM → DCR → PKCE → token → MCP)
│   ├── seed.mjs                Seed demo data for harsh@demo.io
│   └── seed-maya.mjs           Leave maya's ledger empty (for the isolation demo)
└── murmur-app/                 The Skybridge MCP App (runs natively)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── server.ts           authplaneProvider + 6 tools
        ├── store.ts            node:sqlite
        ├── helpers.ts          generateHelpers<AppType>()
        └── views/              contact-card · search-results · recent-dashboard · identity · note-result · delete-result

render.yaml                  Render Blueprint (authserver + app, one click)
authplane.Dockerfile         1-line wrapper around authplane/authserver:latest
```

## Tools

| Tool              | Scope            | View               | Purpose                                       |
| ----------------- | ---------------- | ------------------ | --------------------------------------------- |
| `add-contact`     | `contacts:write` | `contact-card`     | Create a person; render their profile.        |
| `add-note`        | `contacts:write` | `contact-card`     | Append a note; view re-renders with it on top.|
| `search-contacts` | `contacts:read`  | `search-results`   | Free-text search over name + context + notes. |
| `list-recent`     | `contacts:read`  | `recent-dashboard` | Last N contacts touched, with last snippet.  |
| `delete-contact`  | `contacts:write` | `delete-result`    | Remove a contact (and its notes).             |
| `who-am-i`        | (any sign-in)    | `identity`         | Render the verified JWT claims.               |

## Bring-up

**Prereqs:** Docker, Node 24, npm.

### 1. AuthPlane (Docker)

```bash
cp .env.example .env
# macOS / Linux
./start.sh
# Windows (PowerShell)
.\start.ps1
```

This generates secrets, brings up the `authserver` container on
`http://localhost:9000`, creates two demo users, and prints the
cheat sheet.

### 2. Murmur (native)

```bash
cd murmur-app
npm install
AUTHPLANE_ISSUER=http://localhost:9000 SERVER_URL=http://localhost:3000/mcp npm run dev -- --plain
```

Open the printed dev URL in Claude (Customize → Connectors) or ChatGPT
(Profile → Apps → Developer mode). Log in with one of the demo users
created by `start.sh`/`start.ps1` (the credentials are in `.env`).

## Verification

```bash
node scripts/e2e-oauth.mjs --headless --user harsh
node scripts/e2e-oauth.mjs --headless --user maya
```

The script walks PRM discovery → AS metadata → DCR → PKCE-S256 →
login → consent → token exchange → scope-gated tool calls. Sixteen
green checkmarks means the OAuth stack is wired correctly.

Per-user isolation: log in as `maya`, search "Sam" → no results
(`harsh`'s contacts aren't visible). Isolation comes from the JWT `sub`
claim, not from a `WHERE user_id = ?` filter we wrote.

## Deploy on Render (one Blueprint, two services)

The repo ships a `render.yaml` that provisions both services. Render
dashboard → **New** → **Blueprint** → pick the repo. It will create:

- `murmur-authserver` — the AuthPlane authorization server (Docker,
  upstream `authplane/authserver:latest`, persistent disk at `/data`).
- `murmur-app` — the Skybridge MCP App (Node, native `npm run start`).

After the first deploy, copy each service's public URL and update the
**other** service's env vars so the two URLs line up:

- `murmur-authserver` → `AUTHPLANE_SERVER_ISSUER` = its own URL,
  `AUTHPLANE_RESOURCE_URI` = `https://<app>/mcp`
- `murmur-app` → `AUTHPLANE_ISSUER` = the authserver URL,
  `SERVER_URL` = `https://<app>/mcp`

Then **Manual Deploy** on both. Free tier sleeps after 15 min of
inactivity — the first OAuth handshake takes ~30s to wake the service.

## License

MIT.
