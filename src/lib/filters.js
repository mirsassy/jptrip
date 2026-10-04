// Filters shared by every view, saved on the device between sessions.

export const DEFAULT_FILTERS = {
  people: [],      // person names; empty = everyone
  groups: [],      // group names (expanded to their members)
  cities: [],      // empty = all cities
  types: [],       // stay, transport, reservation, note, idea; empty = all
  statuses: ['Idea', 'Tentative', 'Confirmed'], // Cancelled shows only when picked
  from: '',        // YYYY-MM-DD
  to: '',
  kidOnly: false,  // restaurant ideas layer
};

const KEY = 'trip.filters.v1';

export function loadFilters(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch { /* private mode or bad JSON */ }
  return { ...DEFAULT_FILTERS };
}

export function saveFilters(f, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(f)); } catch { /* ignore */ }
}

/** People selected by the person and group filters; empty = no restriction. */
export function selectedPeople(model, f) {
  const set = new Set(f.people);
  f.groups.forEach((g) => model.groups.find((x) => x.name === g)?.members.forEach((m) => set.add(m)));
  return model.people.map((p) => p.name).filter((n) => set.has(n));
}

export function activeFilterCount(f) {
  let n = 0;
  if (f.people.length) n++;
  if (f.groups.length) n++;
  if (f.cities.length) n++;
  if (f.types.length) n++;
  if (f.from || f.to) n++;
  if (f.kidOnly) n++;
  const def = DEFAULT_FILTERS.statuses;
  if (f.statuses.length !== def.length || f.statuses.some((s) => !def.includes(s))) n++;
  return n;
}

/**
 * Item test. `ignoreDates` is used by the Day view and the map's date picker,
 * which choose their own date.
 */
export function makePass(model, f, { ignoreDates = false } = {}) {
  const people = selectedPeople(model, f);
  const cities = f.cities.map((c) => c.toLowerCase());
  return (it) => {
    if (f.types.length && !f.types.includes(it.type)) return false;
    const statuses = f.statuses.length ? f.statuses : DEFAULT_FILTERS.statuses;
    if (!statuses.includes(it.status) && !(it.status !== 'Cancelled' && !['Idea', 'Tentative', 'Confirmed'].includes(it.status))) return false;
    if (cities.length && !it.cities.some((c) => cities.some((x) => c.toLowerCase() === x || c.toLowerCase().includes(x)))) return false;
    if (it.type === 'idea') {
      if (f.kidOnly && it.kid !== 'Yes') return false;
    } else if (people.length && !it.people.some((p) => people.includes(p))) return false;
    if (!ignoreDates && (f.from || f.to) && it.date) {
      const last = it.endDate ? it.endDate : it.date;
      if (f.from && last < f.from) return false;
      if (f.to && it.date > f.to) return false;
    }
    return true;
  };
}
