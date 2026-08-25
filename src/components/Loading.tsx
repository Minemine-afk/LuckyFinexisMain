export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "err" | "ok" | "info";
  children: React.ReactNode;
}) {
  return (
    <div className={`alert ${kind}`} role={kind === "err" ? "alert" : "status"}>
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
