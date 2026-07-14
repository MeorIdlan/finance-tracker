import { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive';
  label: string;
  children: ReactNode;
}

export default function IconButton({
  variant = 'default',
  label,
  className = '',
  children,
  ...props
}: IconButtonProps) {
  const color =
    variant === 'destructive'
      ? 'text-danger hover:bg-danger/10'
      : 'text-muted hover:text-ink hover:bg-surface-raised';
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${color} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
