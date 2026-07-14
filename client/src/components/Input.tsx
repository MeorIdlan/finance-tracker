import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, className = '', ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      id={id}
      className={`w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent ${className}`}
      {...props}
    />
  );
  if (!label) return input;
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {input}
    </label>
  );
});

export default Input;
