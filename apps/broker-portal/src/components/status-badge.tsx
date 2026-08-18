export function StatusBadge({ status }: { status: string }) {
  const cls = `nl-badge nl-badge-${status.toLowerCase()}`;
  return <span className={cls}>{status.replace(/_/g, ' ')}</span>;
}
