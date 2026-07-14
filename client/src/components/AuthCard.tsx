import { ReactNode } from 'react';

export default function AuthCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="mb-4 text-lg font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </main>
  );
}
