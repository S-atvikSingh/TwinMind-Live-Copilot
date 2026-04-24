export default function FixedStatus({ status, progress }) {
  const type = status?.type || "idle";
  const pct = Math.max(0, Math.min(100, progress || 0));
  return (
    <div className={`status-slot ${type}`}>
      <div className="status-text">{status?.message || ""}</div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
