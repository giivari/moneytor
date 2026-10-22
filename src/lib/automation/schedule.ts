export type Frequency = "daily" | "weekdays" | "weekly" | "monthly_day" | "monthly_last_day";
export type Schedule = { frequency: Frequency; weekday?: number | null; monthDay?: number | null; localTime: string; startOn: string; endOn?: string | null };

export function jakartaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Tanggal jadwal tidak valid.");
  return value;
}
export function addDays(day: string, count: number): string {
  const date = new Date(`${dateOnly(day)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function scheduledAt(day: string, localTime: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error("Waktu jadwal tidak valid.");
  return new Date(`${dateOnly(day)}T${localTime}:00+07:00`).toISOString();
}
export function occursOn(schedule: Schedule, day: string): boolean {
  dateOnly(day);
  if (day < schedule.startOn || (schedule.endOn && day > schedule.endOn)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = ((date.getUTCDay() + 6) % 7) + 1;
  switch (schedule.frequency) {
    case "daily": return true;
    case "weekdays": return weekday <= 5;
    case "weekly": return weekday === schedule.weekday;
    case "monthly_day": return date.getUTCDate() === schedule.monthDay;
    case "monthly_last_day": return addDays(day, 1).slice(0, 7) !== day.slice(0, 7);
  }
}
export function preview(schedule: Schedule, from: string, count = 5): string[] {
  const results: string[] = [];
  for (let i = 0; i < 370 && results.length < count; i++) {
    const day = addDays(from, i);
    if (occursOn(schedule, day)) results.push(scheduledAt(day, schedule.localTime));
  }
  return results;
}
