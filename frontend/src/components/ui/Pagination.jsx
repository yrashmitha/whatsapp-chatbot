export default function Pagination({ page, total, limit, onChange }) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  const btn = (label, target, disabled) => (
    <button
      key={label}
      onClick={() => !disabled && onChange(target)}
      disabled={disabled}
      className={`min-w-[32px] h-8 px-2 text-sm rounded border transition-colors
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-violet-50 hover:border-violet-300'}
        ${target === page ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-600 hover:border-violet-600' : 'bg-white text-slate-600 border-slate-200'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      {btn('‹', page - 1, page === 1)}
      {start > 1 && <>{btn(1, 1, false)}{start > 2 && <span className="px-1 text-slate-400">…</span>}</>}
      {pages.map(p => btn(p, p, false))}
      {end < totalPages && <>{end < totalPages - 1 && <span className="px-1 text-slate-400">…</span>}{btn(totalPages, totalPages, false)}</>}
      {btn('›', page + 1, page === totalPages)}
    </div>
  );
}
