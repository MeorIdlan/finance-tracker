export default function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded border border-border px-2 py-1 disabled:opacity-30"
      >
        ‹
      </button>
      <span className="font-mono tabular-nums">
        Page {page} of {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        className="rounded border border-border px-2 py-1 disabled:opacity-30"
      >
        ›
      </button>
    </div>
  );
}
