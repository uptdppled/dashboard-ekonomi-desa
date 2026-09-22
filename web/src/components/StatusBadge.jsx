export default function StatusBadge({ status }) {
  if (!status) return null;
  const cls = 'badge-' + status.toLowerCase().replace(/\s+/g, '-');
  return <span className={`badge ${cls}`}>{status}</span>;
}
