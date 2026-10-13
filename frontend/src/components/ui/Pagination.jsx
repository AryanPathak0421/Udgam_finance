export default function Pagination({ page, totalPages, total, limit, onPage }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="pagination">
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="pagination-btns">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span className="page-indicator">
          Page {page} of {totalPages}
        </span>
        <button className="btn sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
