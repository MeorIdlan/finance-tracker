import { SelectHTMLAttributes, forwardRef } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, id, className = '', children, ...props },
  ref,
) {
  const select = (
    <select
      ref={ref}
      id={id}
      className={`w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    >
      {children}
    </select>
  );
  if (!label) return select;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {select}
    </label>
  );
});

export default Select;
