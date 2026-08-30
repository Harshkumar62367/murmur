// Murmur — recent contacts dashboard.
// The "home screen" of the app: shows the caller's most-recently-touched
// contacts, with the last note snippet. Grouped by recency.
// All styling via inline styles (MCP App host doesn't load Tailwind).

import { useToolInfo } from "../helpers.js";
import { useSendFollowUpMessage } from "skybridge/web";

type Item = {
  contact: { id: string; name: string; context: string | null };
  lastNote: { id: string; body: string; createdAt: number } | null;
  lastContactedAt: number;
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

const bucket = (ts: number): "Today" | "This week" | "Earlier" => {
  const dayMs = 24 * 60 * 60 * 1000;
  const age = Date.now() - ts;
  if (age < dayMs) return "Today";
  if (age < 7 * dayMs) return "This week";
  return "Earlier";
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

const snippet = (s: string, n = 80) => (s.length > n ? s.slice(0, n) + "…" : s);

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

const subtleStyle: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(15, 23, 42, 0.5)",
};

const groupLabelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "rgba(15, 23, 42, 0.5)",
  fontWeight: 500,
  paddingTop: 4,
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

const noteRowStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(15, 23, 42, 0.6)",
  fontStyle: "italic",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export default function RecentDashboard() {
  const { output, isPending } = useToolInfo<"list-recent">();
  const sendFollowUp = useSendFollowUpMessage();

  if (isPending || !output) {
    return <div style={{ ...cardStyle, color: "rgba(15,23,42,0.6)", fontSize: 13 }}>Loading your CRM…</div>;
  }

  const items = (output.items as Item[]) ?? [];

  if (items.length === 0) {
    return (
      <div style={{
        ...cardStyle,
        padding: 20,
        background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" strokeLinecap="round" strokeDasharray="2 3" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" strokeLinecap="round" />
              <circle cx="9" cy="10" r="0.5" fill="white" />
              <circle cx="15" cy="10" r="0.5" fill="white" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Your second brain is empty.</div>
            <div style={{ fontSize: 12, color: "rgba(15,23,42,0.6)" }}>Start by remembering someone you met.</div>
          </div>
        </div>
        <button
          onClick={() => sendFollowUp("Help me add my first contact. Ask me who I just talked to.")}
          style={{
            width: "100%",
            background: "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Get started — add a contact
        </button>
      </div>
    );
  }

  // Group by recency bucket
  const groups: Record<string, Item[]> = { Today: [], "This week": [], Earlier: [] };
  for (const it of items) {
    groups[bucket(it.lastContactedAt)].push(it);
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={labelStyle}>Where you left off</span>
        <span style={subtleStyle}>{items.length} contact{items.length === 1 ? "" : "s"}</span>
      </div>
      {(["Today", "This week", "Earlier"] as const).map(
        (label) =>
          groups[label].length > 0 && (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={groupLabelStyle}>{label}</div>
              <ul style={{ display: "flex", flexDirection: "column" }}>
                {groups[label].map((it) => (
                  <li
                    key={it.contact.id}
                    onClick={() =>
                      sendFollowUp(
                        `Open ${it.contact.name} (contact id ${it.contact.id}).`,
                      )
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
                        width: 36, height: 36, borderRadius: "50%",
                        background: avatarGradient(it.contact.name),
                        color: "#ffffff", fontSize: 14, fontWeight: 600,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.1)", flexShrink: 0,
                      }}
                    >
                      {initials(it.contact.name) || "?"}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.contact.name}
                        </div>
                        <div style={{ ...subtleStyle, flexShrink: 0 }}>{relTime(it.lastContactedAt)}</div>
                      </div>
                      {it.lastNote ? (
                        <div style={noteRowStyle}>"{snippet(it.lastNote.body, 60)}"</div>
                      ) : it.contact.context ? (
                        <div style={noteRowStyle}>{it.contact.context}</div>
                      ) : (
                        <div style={{ ...noteRowStyle, color: "rgba(15,23,42,0.4)" }}>no notes yet</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
    </div>
  );
}
