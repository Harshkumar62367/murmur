// Murmur — delete confirmation view.
// All styling via inline styles (MCP App host doesn't load Tailwind).

export default function DeleteResult() {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 16,
        border: "2px solid #dc2626",
        background: "#fef2f2",
        color: "#7f1d1d",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "rgba(127, 29, 29, 0.7)",
          fontWeight: 500,
          marginBottom: 4,
        }}
      >
        Deleted
      </div>
      <div style={{ fontSize: 13 }}>
        The contact and all their notes have been removed from your CRM.
      </div>
      <div
        style={{
          fontSize: 10,
          color: "rgba(127, 29, 29, 0.6)",
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(220, 38, 38, 0.2)",
        }}
      >
        Verified by AuthPlane · Destructive operation
      </div>
    </div>
  );
}
