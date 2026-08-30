#!/usr/bin/env node
/**
 * SplitTab × AuthPlane — scripted end-to-end OAuth 2.1 flow.
 *
 * Exercises the exact wire moves Claude/ChatGPT make:
 *   1. DCR  — register this script as an OAuth client (RFC 7591)
 *   2. PKCE — S256 code challenge
 *   3. Authorize (auth code + PKCE + resource indicator)
 *   4. Login + consent (headless form POSTs, cookie jar) — or --browser mode
 *   5. Token exchange → JWT access token (sub/aud/scope printed)
 *   6. Authenticated MCP calls: initialize → tools/list → tools/call
 *
 * Usage:
 *   node scripts/e2e-oauth.mjs [--headless] [--user harsh|maya|<email>] \
 *       [--password <pw>] [--browser]
 *
 * Defaults: AS http://localhost:9000 · RS http://localhost:3001/mcp
 *           headless login harsh@demo.io / speedrun-demo-1
 */

import http from "node:http";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const AS = process.env.AUTHPLANE_ISSUER || "https://murmur-authserver.onrender.com";
const RS = process.env.SERVER_URL || "https://murmur-app.onrender.com/mcp";
const CALLBACK_PORT = Number(flag("port") || 9999);
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const USER =
  flag("user") === "maya" ? "maya@demo.io"
  : flag("user") === "harsh" ? "harsh@demo.io"
  : (flag("as") || flag("user") || "harsh@demo.io");
const PASSWORD =
  flag("password") ||
  (USER === "maya@demo.io" ? "speedrun-demo" : USER === "harsh@demo.io" ? "speedrun-demo" : "");
const HEADLESS = has("headless") || !has("browser");
const TIMEOUT_MS = 180_000;

const log = (...m) => console.log(...m);
const b64url = (buf) => Buffer.from(buf).toString("base64url");

/* ---- minimal cookie jar ---- */
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
const storeCookies = (res) => {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
};

async function req(url, opts = {}) {
  const res = await fetch(url, {
    redirect: "manual",
    ...opts,
    headers: { cookie: cookieHeader(), ...(opts.headers || {}) },
  });
  storeCookies(res);
  return res;
}

async function jsonPost(url, body) {
  const res = await req(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) throw new Error(`${res.status} ${url}\n${text}`);
  return parsed;
}

/** Extract hidden inputs from an HTML form (values HTML-entity decoded). */
function formFields(html) {
  const fields = {};
  const inputRe = /<input[^>]*>/g;
  let m;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const rawValue = /value="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (name) {
      fields[name] = rawValue
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'");
    }
  }
  return fields;
}

async function main() {
  log(`\n=== SplitTab × AuthPlane scripted OAuth flow ===`);
  log(`AS: ${AS}\nRS: ${RS}\nLogin as: ${USER} (${HEADLESS ? "headless" : "browser"})\n`);

  // 1. Dynamic Client Registration
  const reg = await jsonPost(`${AS}/oauth/register`, {
    client_name: `speedrun-script-${Date.now()}`,
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  const clientId = reg.client_id;
  log(`✓ 1. DCR — client registered: ${clientId}`);

  // 2. PKCE
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  log(`✓ 2. PKCE — S256 challenge ready`);

  // 3. Authorize
  const authUrl =
    `${AS}/oauth/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&resource=${encodeURIComponent(RS)}` +
    `&scope=${encodeURIComponent(process.env.OAUTH_SCOPES || "contacts:read contacts:write")}` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=speedrun`;

  let code;
  if (HEADLESS) {
    // 3a. hit authorize → redirected to /login with session cookie
    let res = await req(authUrl);
    log(`✓ 3. authorize → ${res.status} ${res.headers.get("location") || "(inline)"}`);
    if (res.status >= 300 && res.status < 400 && !res.headers.get("location")?.includes("/login")) {
      // not asking for login — maybe direct consent or straight code
      const loc = res.headers.get("location");
      if (loc?.includes("code=")) code = new URL(loc, AS).searchParams.get("code");
    }
    if (!code) {
      // 3b. fetch login page (with its redirect param so the flow resumes), parse CSRF
      const loginPageUrl = res.headers.get("location");
      const loginUrl = loginPageUrl
        ? new URL(loginPageUrl, AS).href
        : `${AS}/login`;
      const loginHtml = await (await req(loginUrl)).text();
      const fields = formFields(loginHtml);
      if (!fields.csrf_token) throw new Error("no csrf_token on login page");
      // 3c. submit credentials
      res = await req(`${AS}/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrf_token: fields.csrf_token,
          redirect: fields.redirect ?? "",
          email: USER,
          password: PASSWORD,
        }),
      });
      const loc = res.headers.get("location") || "";
      log(`✓ 4. login → ${res.status} ${loc || "(awaiting consent)"}`);

      // 3d. follow the authorize flow: consent form (if required) → code
      let next = loc;
      for (let hop = 0; hop < 8 && next && !next.includes("code="); hop++) {
        const url = new URL(next, AS);
        res = await req(url.href);
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400) {
          next = location || "";
          continue;
        }
        const html = await res.text();
        const fields = formFields(html);
        if (!fields.csrf_token) throw new Error(`unexpected page at ${url.pathname} (no form)`);
        // consent form: scope checkboxes (repeated), session_id, action=allow
        const scopeValues = [...html.matchAll(/<input[^>]*name="scopes"[^>]*value="([^"]*)"[^>]*>/g)]
          .concat([...html.matchAll(/<input[^>]*value="([^"]*)"[^>]*name="scopes"[^>]*>/g)])
          .map((m) => m[1]);
        const params = new URLSearchParams();
        params.set("csrf_token", fields.csrf_token);
        if (fields.session_id) params.set("session_id", fields.session_id);
        for (const s of scopeValues) params.append("scopes", s);
        params.set("remember", "on");
        params.set("action", "allow");
        const action = /<form[^>]*action="([^"]*)"/.exec(html)?.[1] || url.pathname;
        res = await req(new URL(action, AS).href, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: params,
        });
        log(`✓ 5. consent approved → ${res.status}`);
        next = res.headers.get("location") || "";
      }
      if (!next?.includes("code=")) {
        throw new Error(`no code in final redirect: ${next ?? "(none)"}`);
      }
      code = new URL(new URL(next, AS)).searchParams.get("code");
    }
  } else {
    // browser mode: local callback listener
    const codePromise = new Promise((resolve, reject) => {
      const server = http.createServer((rq, rs) => {
        const url = new URL(rq.url, `http://localhost:${CALLBACK_PORT}`);
        rs.writeHead(200, { "content-type": "text/html" });
        rs.end("<h2>✓ Authorization captured — you can close this tab.</h2>");
        if (url.searchParams.get("error")) {
          reject(new Error(`authorize error: ${url.searchParams.get("error")}`));
        } else resolve(url.searchParams.get("code"));
        server.close();
      });
      server.listen(CALLBACK_PORT);
      setTimeout(() => reject(new Error("timed out waiting for browser callback")), TIMEOUT_MS);
    });
    log(`\n➜ Open in a browser and log in as ${USER}:\n\n${authUrl}\n`);
    code = await codePromise;
  }

  log(`✓ 6. Authorization code captured (${code.slice(0, 12)}…)`);

  // 4. Token exchange (form-encoded)
  const tokenRes = await req(`${AS}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}: ${tokenText}`);
  const tokenJson = JSON.parse(tokenText);
  const accessToken = tokenJson.access_token;
  const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString());
  log(`✓ 7. Token exchange — JWT issued`);
  log(`    sub=${claims.sub}  aud=${claims.aud}  scope=${claims.scope}  exp=${new Date(claims.exp * 1000).toISOString()}`);

  // 5. Authenticated MCP calls
  const mcp = async (method, params, sessionId) => {
    const res = await req(RS, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${accessToken}`,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    });
    const sid = res.headers.get("mcp-session-id") || sessionId;
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    const body = line ? JSON.parse(line.slice(5)) : text ? JSON.parse(text) : {};
    if (body.error) throw new Error(`MCP ${method}: ${JSON.stringify(body.error)}`);
    return { body, sid };
  };

  const init = await mcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "speedrun-script", version: "0.1.0" },
  });
  const sid = init.sid;
  log(`✓ 8. MCP initialize — ${init.body.result.serverInfo.name} v${init.body.result.serverInfo.version}`);

  await req(RS, {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-session-id": sid, authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  const tools = await mcp("tools/list", {}, sid);
  log(`✓ 9. tools/list — ${tools.body.result.tools.map((t) => t.name).join(", ")}`);

  const addContact = await mcp("tools/call", {
    name: "add-contact",
    arguments: { name: "Sam Lee", context: "met at the conference, working on agent identity" },
  }, sid);
  const contactId = addContact.body.result?.structuredContent?.contact?.id;
  log(`✓ 10. add-contact — ${addContact.body.result.content?.[0]?.text}`);

  const addNote = await mcp("tools/call", {
    name: "add-note",
    arguments: { contactId, body: "We talked about OIDC federation and his new blog post." },
  }, sid);
  log(`✓ 11. add-note — ${addNote.body.result.content?.[0]?.text}`);

  const search = await mcp("tools/call", {
    name: "search-contacts",
    arguments: { query: "OIDC" },
  }, sid);
  log(`✓ 12. search-contacts — ${search.body.result.content?.[0]?.text}`);

  const recent = await mcp("tools/call", { name: "list-recent", arguments: { limit: 5 } }, sid);
  log(`✓ 13. list-recent — ${recent.body.result.content?.[0]?.text}`);

  const del = await mcp("tools/call", { name: "delete-contact", arguments: { contactId } }, sid);
  log(`✓ 14. delete-contact — ${del.body.result.content?.[0]?.text}`);

  const after = await mcp("tools/call", { name: "list-recent", arguments: { limit: 5 } }, sid);
  log(`✓ 15. list-recent (after delete) — ${after.body.result.content?.[0]?.text}`);

  const who = await mcp("tools/call", { name: "who-am-i", arguments: {} }, sid);
  log(`✓ 16. who-am-i — ${who.body.result.content?.[0]?.text}`);

  log(`\n=== END-TO-END OAUTH FLOW COMPLETE (user ${USER}) ===\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
