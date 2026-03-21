/**
 * Shared UI primitives reused across Settings section components.
 */

"use client";

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4">
      {children}
    </h2>
  );
}

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-3 cursor-pointer select-none">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">
          {label}
        </p>
        {description ? (
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`
          relative w-11 h-6 rounded-full border transition-colors shrink-0
          ${
            checked
              ? "bg-[var(--accent)] border-[var(--accent)]"
              : "bg-[var(--surface-alt)] border-[var(--border)]"
          }
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform
            ${
              checked
                ? "translate-x-5 bg-[var(--accent-contrast)]"
                : "translate-x-0 bg-[var(--text-muted)]"
            }
          `}
        />
      </button>
    </label>
  );
}

export function ChipSelector<T extends string | number | null>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`
              px-4 py-2 rounded-full text-[13px] font-medium border transition-colors
              ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--surface-alt)]"
              }
            `}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
