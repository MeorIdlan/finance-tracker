export function dueDateInMonth(
  year: number,
  monthIdx: number,
  dueDay: number,
): Date {
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIdx, Math.min(dueDay, lastDay)));
}

function stripTime(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function nextDueDateFrom(dueDay: number, from = new Date()): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const thisMonth = dueDateInMonth(y, m, dueDay);
  return thisMonth >= stripTime(from)
    ? thisMonth
    : dueDateInMonth(y, m + 1, dueDay);
}

export function shiftDueDate(
  current: Date,
  dueDay: number,
  deltaMonths: number,
): Date {
  return dueDateInMonth(
    current.getUTCFullYear(),
    current.getUTCMonth() + deltaMonths,
    dueDay,
  );
}

const DUE_SOON_DAYS = 14;

export function commitmentStatus(
  nextDueDate: Date,
  today = new Date(),
): 'overdue' | 'dueSoon' | 'upcoming' {
  const t = stripTime(today).getTime();
  const due = stripTime(nextDueDate).getTime();
  if (due < t) return 'overdue';
  if (due - t <= DUE_SOON_DAYS * 24 * 60 * 60 * 1000) return 'dueSoon';
  return 'upcoming';
}
