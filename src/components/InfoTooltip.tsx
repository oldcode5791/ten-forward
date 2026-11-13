export function InfoTooltip({
  text,
  position = 'top',
}: {
  text: string;
  position?: 'top' | 'bottom';
}) {
  const posClasses =
    position === 'bottom'
      ? 'top-full right-0 mt-2'
      : 'bottom-full left-1/2 -translate-x-1/2 mb-2';

  return (
    <span className="relative inline-flex items-center group no-print">
      <button
        type="button"
        aria-label={text}
        title={text}
        className="w-4 h-4 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-300 hover:text-cyan-300 flex items-center justify-center cursor-help leading-none"
      >
        ?
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 absolute ${posClasses} w-64 p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-normal normal-case leading-snug text-slate-200 shadow-2xl z-50 text-left`}
      >
        {text}
      </span>
    </span>
  );
}
