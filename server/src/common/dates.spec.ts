import {
  commitmentStatus,
  dueDateInMonth,
  nextDueDateFrom,
  shiftDueDate,
} from './dates';

describe('date helpers', () => {
  it('clamps the due day to the month length', () => {
    expect(dueDateInMonth(2026, 1, 31).toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
    expect(dueDateInMonth(2026, 0, 31).toISOString().slice(0, 10)).toBe(
      '2026-01-31',
    );
  });

  it('nextDueDateFrom picks this month when still ahead, else next month', () => {
    const from = new Date(Date.UTC(2026, 6, 10)); // 2026-07-10
    expect(nextDueDateFrom(15, from).toISOString().slice(0, 10)).toBe(
      '2026-07-15',
    );
    expect(nextDueDateFrom(5, from).toISOString().slice(0, 10)).toBe(
      '2026-08-05',
    );
    expect(nextDueDateFrom(10, from).toISOString().slice(0, 10)).toBe(
      '2026-07-10',
    );
  });

  it('shiftDueDate moves by months and re-clamps to the due day', () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31));
    expect(shiftDueDate(jan31, 31, 1).toISOString().slice(0, 10)).toBe(
      '2026-02-28',
    );
    const feb28 = new Date(Date.UTC(2026, 1, 28));
    expect(shiftDueDate(feb28, 31, 1).toISOString().slice(0, 10)).toBe(
      '2026-03-31',
    );
    expect(shiftDueDate(feb28, 31, -1).toISOString().slice(0, 10)).toBe(
      '2026-01-31',
    );
  });

  it('commitmentStatus buckets by proximity', () => {
    const today = new Date(Date.UTC(2026, 6, 10));
    expect(commitmentStatus(new Date(Date.UTC(2026, 6, 9)), today)).toBe(
      'overdue',
    );
    expect(commitmentStatus(new Date(Date.UTC(2026, 6, 20)), today)).toBe(
      'dueSoon',
    );
    expect(commitmentStatus(new Date(Date.UTC(2026, 7, 20)), today)).toBe(
      'upcoming',
    );
  });
});
