//! Dates, in this Mac's timezone, as the TypeScript page has them in the native app (`src/lib/dates.ts`).

use crate::{Entry, State};
use wings_plugin::host;

const DAY_MS: f64 = 86_400_000.0;
const WEEKDAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/// Days since 1970-01-01 of a date (Howard Hinnant's `days_from_civil`).
fn days_of(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

/// The date of a day since 1970-01-01 (`civil_from_days`).
fn date_of(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, doy - (153 * mp + 2) / 5 + 1)
}

fn numbers<const N: usize>(text: &str, separators: &[char]) -> [i64; N] {
    let mut out = [0; N];
    for (slot, part) in out.iter_mut().zip(text.split(separators)) {
        *slot = part.parse().unwrap_or(0);
    }
    out
}

/// The parts of a YYYY-MM-DD day.
fn ymd(day: &str) -> (i64, i64, i64) {
    let [y, m, d] = numbers(day, &['-']);
    (y, m, d)
}

fn day_text(days: i64) -> String {
    let (y, m, d) = date_of(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The instant of an ISO time as Cyclops sends them, `2026-11-11T10:00:00.000Z`, in ms since the epoch.
pub fn parse(iso: &str) -> f64 {
    let (date, time) = iso.split_once('T').unwrap_or((iso, ""));
    let (y, m, d) = ymd(date);
    let time = time.trim_end_matches('Z');
    let (clock, fraction) = time.split_once('.').unwrap_or((time, "0"));
    let [hh, mm, ss] = numbers(clock, &[':']);
    let ms: f64 = format!("0.{fraction}").parse().unwrap_or(0.0);
    (days_of(y, m, d) * 86_400 + hh * 3600 + mm * 60 + ss) as f64 * 1000.0 + (ms * 1000.0).round()
}

/// An instant as `Date.prototype.toISOString` writes it.
pub fn iso(ms: f64) -> String {
    let whole = ms.floor() as i64;
    let (days, rest) = (whole.div_euclid(86_400_000), whole.rem_euclid(86_400_000));
    format!("{}T{:02}:{:02}:{:02}.{:03}Z", day_text(days), rest / 3_600_000, rest / 60_000 % 60, rest / 1000 % 60, rest % 1000)
}

/// An instant as a wall clock here reads it, in ms.
fn local(ms: f64) -> f64 {
    ms + f64::from(host::utc_offset(ms)) * 60_000.0
}

/// YYYY-MM-DD here.
pub fn day_of(ms: f64) -> String {
    day_text((local(ms) / DAY_MS).floor() as i64)
}
pub fn today() -> String {
    day_of(host::now())
}
pub fn add_days(day: &str, n: i64) -> String {
    let (y, m, d) = ymd(day);
    day_text(days_of(y, m, d) + n)
}
/// 0 for Sunday.
fn weekday(day: &str) -> i64 {
    let (y, m, d) = ymd(day);
    (days_of(y, m, d) + 4).rem_euclid(7)
}
pub fn monday_of(day: &str) -> String {
    add_days(day, -((weekday(day) + 6) % 7))
}
/// Monday of this week, or of a week before it.
pub fn week_start(weeks_back: i64) -> String {
    add_days(&monday_of(&today()), -7 * weeks_back)
}

#[derive(Clone, Copy, PartialEq)]
pub enum Style {
    Short,
    Long,
}

/// A day in words as en-GB writes it: "Wed 7", "Wed, 7 Oct 2025" or "Monday 5 October".
pub fn day_label(day: &str, weekday_style: Option<Style>, month: Option<Style>, year: bool) -> String {
    let (y, m, d) = ymd(day);
    let name = |list: &[&str], at: usize, style| if style == Style::Long { list[at].to_owned() } else { list[at][..3].to_owned() };
    let named = weekday_style.map(|style| name(&WEEKDAYS, weekday(day) as usize, style)).map(|n| if year { format!("{n},") } else { n });
    [named, Some(d.to_string()), month.map(|style| name(&MONTHS, (m - 1) as usize, style)), year.then(|| y.to_string())]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ")
}

/// "5 Oct – 11 Oct", with the years when the week isn't in this one.
pub fn week_range(monday: &str) -> String {
    let sunday = add_days(monday, 6);
    let year = &today()[..4];
    let other = !(monday.starts_with(year) && sunday.starts_with(year));
    format!("{} – {}", day_label(monday, None, Some(Style::Short), other), day_label(&sunday, None, Some(Style::Short), other))
}

/// "Today", or a day like "Wed 7 Oct".
pub fn day_name(day: &str) -> String {
    let today = today();
    if day == today { "Today".into() } else { day_label(day, Some(Style::Short), Some(Style::Short), !day.starts_with(&today[..4])) }
}

/// HH:MM here.
pub fn clock_time(iso: &str) -> String {
    let minutes = (local(parse(iso)) / 60_000.0).floor() as i64;
    format!("{:02}:{:02}", minutes.div_euclid(60).rem_euclid(24), minutes.rem_euclid(60))
}

pub fn duration(minutes: f64) -> String {
    let (h, m) = ((minutes / 60.0).floor(), (minutes % 60.0).round());
    if h > 0.0 { format!("{h}h {m}m") } else { format!("{m}m") }
}

pub fn elapsed(started_at: &str) -> String {
    let s = ((host::now() - parse(started_at)) / 1000.0).floor().max(0.0) as i64;
    format!("{:02}:{:02}:{:02}", s / 3600, s % 3600 / 60, s % 60)
}

pub fn running_minutes(state: &State) -> f64 {
    state.timers.iter().map(|t| (host::now() - parse(&t.started_at)) / 60_000.0).sum()
}

/// The instant a wall-clock time on a day has here. `time` is HH:MM.
pub fn at_time(day: &str, time: &str) -> f64 {
    let (y, m, d) = ymd(day);
    let [hh, mm] = numbers(time, &[':']);
    let wall = (days_of(y, m, d) * 86_400 + hh * 3600 + mm * 60) as f64 * 1000.0;
    // The offset depends on the instant being looked for, so correct the guess once more for a DST change.
    let mut t = wall;
    for _ in 0..2 {
        t = wall - f64::from(host::utc_offset(t)) * 60_000.0;
    }
    t
}

/// Minutes logged on a day, in the week's entries. A running timer counts towards today.
pub fn minutes_on(state: &State, entries: &[Entry], day: &str) -> f64 {
    let logged: f64 = entries.iter().filter(|e| e.ended_at.is_some() && e.entry_date == day).map(|e| e.duration_minutes.unwrap_or(0.0)).sum();
    logged + if day == today() { running_minutes(state) } else { 0.0 }
}
