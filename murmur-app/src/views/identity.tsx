// Murmur — verified session card.
// Shows the verified JWT claims on screen. Bound to the
// `who-am-i` tool via `view: { component: "identity" }`.
//
// All visual chrome uses inline styles because the MCP App host iframe
// does not ship our compiled Tailwind CSS. Light-on-light design +
// a 2px blue border so the card is visible on any host surface.

import { useState } from "react";
import { useToolInfo } from "../helpers.js";

const shortHash = (s: string, head = 8, tail = 4) =>
  s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;

const cardBaseStyle: React.CSSProperties = {
  padding: 20,
  borderRadius: 16,
  background: "#ffffff",
  color: "#0f172a",
  border: "2px solid #2563eb",
  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#64748b",
  fontWeight: 600,
};

const valueStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
  color: "#0f172a",
};

const chipStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 9999,
  fontSize: 12,
  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
  background: "#dbeafe",
  color: "#1e40af",
  fontWeight: 600,
  border: "1px solid #bfdbfe",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 8px",
  borderRadius: 9999,
  fontSize: 10,
  fontWeight: 700,
  background: "#d1fae5",
  border: "1px solid #6ee7b7",
  color: "#065f46",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      style={{
        background: "transparent",
        border: "none",
        color: "#64748b",
        cursor: "pointer",
        padding: 2,
      }}
      title={`Copy ${label}`}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 012-2h10" />
        </svg>
      )}
    </button>
  );
}

export default function Identity() {
  const { output, isPending } = useToolInfo<"who-am-i">();

  if (isPending || !output) {
    return (
      <div style={cardBaseStyle}>
        <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
          </svg>
          Verifying session…
        </div>
      </div>
    );
  }

  const sub = output.subject ?? "unknown";
  const clientId = output.clientId ?? "unknown";
  const exp = output.expiresAt
    ? new Date(output.expiresAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div style={cardBaseStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ ...labelStyle, color: "#10b981", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
          Verified session
        </div>
        <div style={badgeStyle}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
          </svg>
          AuthPlane
        </div>
      </div>

      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", color: "#0f172a", letterSpacing: -0.3, marginBottom: 12 }}>
        {shortHash(sub, 10, 6)}
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", alignItems: "center", fontSize: 13, marginBottom: 12 }}>
        <dt style={labelStyle}>OAuth client</dt>
        <dd style={{ ...valueStyle, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          <span>{shortHash(clientId, 12, 4)}</span>
          <CopyButton text={clientId} label="client id" />
        </dd>

        <dt style={labelStyle}>Token expires</dt>
        <dd style={{ ...valueStyle, textAlign: "right" }}>{exp}</dd>

        <dt style={labelStyle}>Resource</dt>
        <dd style={{ ...valueStyle, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", overflow: "hidden" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={output.resource}>
            {output.resource}
          </span>
          <CopyButton text={output.resource ?? ""} label="resource" />
        </dd>
      </dl>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {(output.scopes ?? []).map((s: string) => (
          <span key={s} style={chipStyle}>{s}</span>
        ))}
      </div>

      <div style={{
        fontSize: 10,
        color: "#94a3b8",
        paddingTop: 8,
        borderTop: "1px solid #e2e8f0",
        display: "flex",
        justifyContent: "space-between",
        fontFamily: "ui-monospace, monospace",
      }}>
        <span>OAuth 2.1 · PKCE-S256 · ES256 · DCR</span>
        <span style={{ color: "#10b981" }}>✓</span>
      </div>
    </div>
  );
}
