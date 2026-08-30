// Murmur — contact card view.
// Shows a contact's profile and notes, with a quick-add note composer.
// Bound to `add-contact` (empty state) and `add-note` (refreshed state).
//
// All visual chrome uses inline styles — the MCP App host iframe does
// not ship our compiled Tailwind CSS, so the views must be self-styled.

import { useState, useEffect, useRef } from "react";
import { useCallTool, useToolInfo } from "../helpers.js";
import { useSendFollowUpMessage } from "skybridge/web";

type NoteOut = { id: string; body: string; createdAt: number };
type ContactOut = { id: string; name: string; context: string | null; createdAt: number };

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

const noteStyle: (highlighted: boolean) => React.CSSProperties = (h) => ({
  fontSize: 13,
  borderRadius: 8,
  padding: "8px 12px",
  background: h ? "#ecfdf5" : "#f1f5f9",
  border: h ? "1px solid #10b981" : "1px solid transparent",
  transition: "all 0.5s ease",
  transform: h ? "scale(1.02)" : "scale(1)",
  boxShadow: h ? "0 0 0 2px rgba(16, 185, 129, 0.2)" : "none",
});

const inputStyle: React.CSSProperties = {
  flex: 1,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  background: "#ffffff",
  color: "#0f172a",
  outline: "none",
};

const buttonPrimary: React.CSSProperties = {
  background: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const buttonDanger: React.CSSProperties = {
  background: "#dc2626",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  cursor: "pointer",
};

const buttonGhost: React.CSSProperties = {
  background: "#e2e8f0",
  color: "#0f172a",
  border: "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  cursor: "pointer",
};

const buttonLinkDanger: React.CSSProperties = {
  background: "transparent",
  color: "rgba(15, 23, 42, 0.5)",
  border: "none",
  padding: "4px 8px",
  fontSize: 10,
  fontWeight: 500,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  cursor: "pointer",
};

export default function ContactCard() {
  const { output, isPending } = useToolInfo<"add-contact" | "add-note">();
  const { callToolAsync: addNote, isPending: saving } = useCallTool("add-note");
  const { callToolAsync: deleteContact, isPending: deleting } = useCallTool("delete-contact");
  const sendFollowUp = useSendFollowUpMessage();
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [justAddedNoteId, setJustAddedNoteId] = useState<string | null>(null);
  const lastNoteCountRef = useRef(0);

  // Be defensive: SDKs (Codex, ChatGPT, Claude) wrap the structuredContent
  // differently. Check both `output.contact` and `output.structuredContent.contact`.
  const sc: any = (output as any)?.structuredContent ?? output;
  const contact: ContactOut | undefined = sc?.contact;
  const recentNotes: NoteOut[] = (sc?.recentNotes as NoteOut[]) ?? [];

  // useEffect MUST be called on every render — placed before any early returns.
  useEffect(() => {
    if (recentNotes.length > lastNoteCountRef.current) {
      const newest = recentNotes[0];
      if (newest) {
        setJustAddedNoteId(newest.id);
        const t = setTimeout(() => setJustAddedNoteId(null), 1500);
        return () => clearTimeout(t);
      }
    }
    lastNoteCountRef.current = recentNotes.length;
  }, [recentNotes]);

  if (isPending || !output) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%",
            background: "#e2e8f0",
          }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 18, width: 140, background: "#e2e8f0", borderRadius: 4, marginBottom: 6 }} />
            <div style={{ height: 12, width: 200, background: "#e2e8f0", borderRadius: 4 }} />
          </div>
        </div>
      </div>
    );
  }

  if (!contact?.id) {
    return (
      <div style={{ ...cardStyle, padding: 16 }}>
        <div style={{ fontSize: 13, color: "#dc2626", fontWeight: 600, marginBottom: 8 }}>
          Could not render contact
        </div>
        <div style={{ fontSize: 11, color: "rgba(15,23,42,0.6)" }}>
          Tool returned no <code style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: 3 }}>contact.id</code>.
        </div>
        <pre style={{ fontSize: 10, color: "rgba(15,23,42,0.5)", background: "#f8fafc", padding: 8, borderRadius: 4, marginTop: 8, overflow: "auto", maxHeight: 160 }}>
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || saving) return;
    setDraft("");
    await addNote({ contactId: contact.id, body });
  };

  return (
    <div style={cardStyle}>
      {/* Header: avatar + name + delete button */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 48, height: 48, borderRadius: "50%",
            background: avatarGradient(contact.name),
            color: "#ffffff", fontSize: 18, fontWeight: 600,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)", flexShrink: 0,
          }}
        >
          {initials(contact.name) || "?"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {contact.name}
          </div>
          {contact.context && (
            <div style={{ fontSize: 12, color: "rgba(15,23,42,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {contact.context}
            </div>
          )}
        </div>
        {!confirmingDelete ? (
          <button onClick={() => setConfirmingDelete(true)} style={buttonLinkDanger}>
            Delete
          </button>
        ) : (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={async () => {
                await deleteContact({ contactId: contact.id });
                sendFollowUp(`Confirm: I deleted ${contact.name}. Show me my recent contacts.`);
              }}
              disabled={deleting}
              style={{ ...buttonDanger, opacity: deleting ? 0.5 : 1 }}
            >
              {deleting ? "Deleting…" : "Yes, delete"}
            </button>
            <button onClick={() => setConfirmingDelete(false)} disabled={deleting} style={buttonGhost}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Notes list */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={labelStyle}>
            Notes {recentNotes.length > 0 && <span>({recentNotes.length})</span>}
          </span>
          {recentNotes.length > 0 && (
            <span style={subtleStyle}>last contact {relTime(recentNotes[0].createdAt)}</span>
          )}
        </div>
        {recentNotes.length === 0 ? (
          <div style={{ ...subtleStyle, fontStyle: "italic", padding: "8px 0", display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            No notes yet — be the first.
          </div>
        ) : (
          <ul style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 224, overflowY: "auto", paddingRight: 4 }}>
            {recentNotes.map((n) => {
              const highlighted = justAddedNoteId === n.id;
              return (
                <li key={n.id} style={noteStyle(highlighted)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={subtleStyle}>{relTime(n.createdAt)}</span>
                    {highlighted && (
                      <span style={{ fontSize: 10, color: "#059669", fontWeight: 600 }}>
                        ✓ saved
                      </span>
                    )}
                  </div>
                  <div>{n.body}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer */}
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          disabled={saving}
          style={{ ...inputStyle, opacity: saving ? 0.5 : 1 }}
        />
        <button
          type="submit"
          disabled={!draft.trim() || saving}
          style={{ ...buttonPrimary, opacity: !draft.trim() || saving ? 0.5 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      {/* Footer */}
      <div style={{ ...subtleStyle, marginTop: 12, paddingTop: 8, borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Private to you</span>
        <span style={{ fontFamily: "ui-monospace, monospace" }}>sub = {contact.id.slice(0, 8)}…</span>
      </div>
    </div>
  );
}
