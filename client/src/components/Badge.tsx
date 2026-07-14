import { ReactNode } from 'react';

type BadgeTone = 'muted' | 'danger' | 'warning' | 'success' | 'accent';

const TONE_CLASSES: Record<BadgeTone, string> = {
  muted: 'bg-surface-raised text-muted',
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  success: 'bg-success/15 text-success',
  accent: 'bg-accent/15 text-accent',
};

export default function Badge({
  tone = 'muted',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
