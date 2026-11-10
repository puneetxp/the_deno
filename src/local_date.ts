// Fast local-time Dates, shared by the MySQL and PostgreSQL clients: both
// return DATETIME/TIMESTAMP values as local-time Dates, as mysql2 and pg do.

const HOUR = 3600000;

/** Local time minus UTC at instant t, in ms (exact, unlike getTimezoneOffset). */
function localMinusUTC(t: number): number {
  const x = new Date(t);
  return Date.UTC(
    x.getFullYear(),
    x.getMonth(),
    x.getDate(),
    x.getHours(),
    x.getMinutes(),
    x.getSeconds(),
    x.getMilliseconds(),
  ) - t;
}

// UTC hour -> local time minus UTC (ms; zones before ~1900 have offsets in
// seconds) for that whole hour, or NaN when it changes inside the hour.
const offsets = new Map<number, number>();

function hourOffset(hour: number): number {
  let o = offsets.get(hour);
  if (o === undefined) {
    const a = localMinusUTC(hour * HOUR);
    const b = localMinusUTC(hour * HOUR + HOUR - 1);
    o = a === b ? a : NaN;
    if (offsets.size > 50000) offsets.clear();
    offsets.set(hour, o);
  }
  return o;
}

/**
 * The same instant as `new Date(y, mo - 1, d, h, mi, sec, ms)`, which is slow
 * because it resolves the time zone each call. When the offset is the same
 * from 15 hours before to 15 hours after (no DST change near; zones are at
 * most 14 hours from UTC), the wall time minus that offset is exact.
 * Otherwise the Date constructor decides.
 */
export function localDate(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  sec: number,
  ms: number,
): Date {
  if (y < 100) {
    // The constructor maps years 0-99 to 1900-1999; 400 years later has the
    // same calendar (and, that far back, no DST).
    const old = new Date(y + 400, mo - 1, d, h, mi, sec, ms);
    old.setFullYear(y);
    return old;
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi, sec, ms);
  const before = hourOffset(Math.floor(wall / HOUR) - 15);
  if (before === hourOffset(Math.floor(wall / HOUR) + 15)) {
    return new Date(wall - before);
  }
  return new Date(y, mo - 1, d, h, mi, sec, ms);
}
