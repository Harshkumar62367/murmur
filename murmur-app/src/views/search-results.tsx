// Murmur — search results view.
// Shows matched contacts with snippets and timestamps.
// All styling via inline styles (MCP App host doesn't load Tailwind).

import { useToolInfo } from "../helpers.js";
import { useSendFollowUpMessage } from "skybridge/web";

type Match = {
  contact: { id: string; name: string; context: string | null };
  lastNote: { id: string; body: string; createdAt: number } | null;
  score: number;
  matchedField: "name" | "context" | "note";
};

const relTime = (ts: number) => {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

const avatarGradient = (name: string) => {
  const hash = [...name].reduce((h, c) => h * 31 + c.charCodeAt(0), 0);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 35) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 75% 45%))`;
};

const snippet = (s: string, n = 100) => (s.length > n ? s.slice(0, n) + "…" : s);

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 16,
  border: "1px solid #cbd5e1",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
  background: "#ffffff",
  color: "#0f172a",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "rgba(15, 23, 42, 0.6)",
  fontWeight: 500,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  borderRadius: 8,
  padding: "8px 12px",
  background: "#f8fafc",
  border: "1px solid transparent",
  cursor: "pointer",
  marginBottom: 6,
};

export default function SearchResults() {
  const { output, isPending } = useToolInfo<"search-contacts">();
  const sendFollowUp = useSendFollowUpMessage();

  if (isPending || !output) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(15,23,42,0.6)", fontSize: 13 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
          </svg>
          Searching your CRM…
        </div>
      </div>
    );
  }

  const matches = (output.matches as Match[]) ?? [];
  const query = output.query as string;

  if (matches.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ opacity: 0.5 }}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35M8 11h6" strokeLinecap="round" />
          </svg>
          <span>
            No contacts matched <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>"{query}"</span>.
          </span>
        </div>
        <div style={{ fontSize: 12, color: "rgba(15,23,42,0.6)", marginTop: 8, marginLeft: 26 }}>
          Try a different keyword, or ask Claude to add the contact first.
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ ...labelStyle, marginBottom: 8 }}>
        {matches.length} match{matches.length === 1 ? "" : "es"} for <span style={{ fontFamily: "ui-monospace, monospace" }}>"{query}"</span>
      </div>
      <ul style={{ display: "flex", flexDirection: "column" }}>
        {matches.map((m) => (
          <li
            key={m.contact.id}
            onClick={() =>
              sendFollowUp(`Open ${m.contact.name} (contact id ${m.contact.id}).`)
            }
            style={rowStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f1f5f9";
              e.currentTarget.style.borderColor = "#e2e8f0";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#f8fafc";
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            <div
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: avatarGradient(m.contact.name),
                color: "#ffffff", fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 1px 4px rgba(0,0,0,0.1)", flexShrink: 0,
              }}
            >
              {initials(m.contact.name) || "?"}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.contact.name}
                </div>
                <div style={{
                  fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5,
                  color: "rgba(15,23,42,0.5)", flexShrink: 0,
                  padding: "2px 6px", background: "#ffffff", borderRadius: 4,
                  border: "1px solid #e2e8f0",
                }}>
                  {m.matchedField}
                </div>
              </div>
              {m.contact.context && (
                <div style={{ fontSize: 12, color: "rgba(15,23,42,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.contact.context}
                </div>
              )}
              {m.lastNote && (
                <div style={{ fontSize: 12, color: "rgba(15,23,42,0.6)", fontStyle: "italic", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  "{snippet(m.lastNote.body, 80)}" · {relTime(m.lastNote.createdAt)}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
