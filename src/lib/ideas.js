// Helpers for the Ideas tab: which ideas fit a day, and whether a timing note says
// the place is closed that day.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * True when a timing note ("Usually closed Mondays (Nov 9).", "Many shops close Sundays")
 * mentions closing on that date's weekday or on that date itself.
 */
export function closedOn(timing, iso) {
  if (!timing || !iso) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = WEEKDAYS[d.getUTCDay()];
  const md = `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return String(timing).split(/(?<=[.;])\s+/).some((sentence) => {
    if (!/\bclos/i.test(sentence)) return false;
    if (new RegExp(`\\b${wd}s?\\b`, 'i').test(sentence)) return true;
    return new RegExp(`\\b${md}\\b(?!\\d)`).test(sentence) && !/\bopens?\b/i.test(sentence);
  });
}

/** Open ideas (not yet booked or dropped) in the given cities, best first. */
export function ideasFor(model, cities, { kidOnly = false, date = '' } = {}) {
  const lc = cities.map((c) => c.toLowerCase());
  return model.items
    .filter((it) => it.type === 'idea' && it.status !== 'Confirmed' && it.status !== 'Cancelled')
    .filter((it) => it.city && lc.includes(it.city.toLowerCase()))
    .filter((it) => !kidOnly || it.kid === 'Yes')
    .sort((a, b) => (closedOn(a.timing, date) - closedOn(b.timing, date))
      || ((b.michelin ? 1 : 0) - (a.michelin ? 1 : 0))
      || a.title.localeCompare(b.title));
}
