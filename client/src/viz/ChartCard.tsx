import { ReactNode } from 'react';

export default function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        border: '1px solid rgba(11,11,11,0.10)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <h2 style={{ fontSize: 14, marginTop: 0 }}>{title}</h2>
      <div style={{ height: 220, position: 'relative' }}>{children}</div>
    </section>
  );
}
