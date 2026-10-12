// ---------- dates, in the user's own timezone ----------

import { state } from "./state";
import type { Entry } from "./types";

const tz = () => state.me?.timezone || "Europe/Zagreb";
/** YYYY-MM-DD in the user's timezone. */
export const dayOf = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(date);
export const today = () => dayOf(new Date());
/** @param day YYYY-MM-DD */
export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** The Monday of a day's week. @param day YYYY-MM-DD */
export const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
/** Monday of this week, or of a week before it. */
export const weekStart = (weeksBack = 0) => addDays(mondayOf(today()), -7 * weeksBack);
/** A YYYY-MM-DD day in words. It's a day in the user's timezone already, so it's formatted as UTC. */
export const dayLabel = (day: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(`${day}T00:00:00Z`));
/** "5 Oct – 11 Oct", with the years when the week isn't in this one, as in the Cyclops web app. */
export function weekRange(monday: string) {
  const sunday = addDays(monday, 6);
  const year = today().slice(0, 4);
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: monday.startsWith(year) && sunday.startsWith(year) ? undefined : "numeric" };
  return `${dayLabel(monday, options)} – ${dayLabel(sunday, options)}`;
}
/** "Today", or a day like "Wed 7 Oct". */
export const dayName = (day: string) => (day === today() ? "Today" : dayLabel(day, { weekday: "short", day: "numeric", month: "short", year: day.startsWith(today().slice(0, 4)) ? undefined : "numeric" }));
export const clockTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
export function elapsed(startedAt: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
}
export const runningMinutes = () => state.timers.reduce((sum, t) => sum + (Date.now() - Date.parse(t.startedAt)) / 60_000, 0);
/** How far the user's timezone is ahead of UTC at an instant, in ms. */
function offsetAt(t: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz(), hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(t);
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}
/** The instant a wall-clock time on a day has in the user's timezone. @param day YYYY-MM-DD @param time HH:MM */
export function atTime(day: string, time: string) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // The offset depends on the instant being looked for, so correct the guess once more for a DST change.
  let t = wall;
  for (let i = 0; i < 2; i++) t = wall - offsetAt(t);
  return new Date(t);
}

/** Minutes logged on a day, in the week's entries. A running timer counts towards today. */
export const minutesOn = (entries: Entry[], day: string) => entries.reduce((n, e) => n + (e.endedAt && e.entryDate === day ? (e.durationMinutes ?? 0) : 0), 0) + (day === today() ? runningMinutes() : 0);
