// Light / dark / automatic (follow the phone) appearance, remembered on this device.
const KEY = 'trip.theme';

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
}

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* still applies for this visit */ }
  applyTheme(theme);
}
