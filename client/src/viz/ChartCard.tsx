import { ReactNode } from 'react';

export default function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </h2>
      <div className="relative h-56">{children}</div>
    </section>
  );
}
