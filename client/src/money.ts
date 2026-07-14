export function formatSen(sen: number): string {
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const rm = (abs / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? '-' : ''}RM ${rm}`;
}

export function parseRM(input: string): number | null {
  const cleaned = input.replace(/,/g, '').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Math.round(parseFloat(cleaned) * 100);
  return Number.isSafeInteger(value) ? value : null;
}
