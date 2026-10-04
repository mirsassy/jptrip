import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Writes dist/sw.js with the list of files to cache and a version hash. */
function serviceWorker() {
  return {
    name: 'trip-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const publicFiles = [];
      const walk = (dir, rel = '') => fs.readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p, `${rel}${f}/`);
        else publicFiles.push(`${rel}${f}`);
      });
      if (fs.existsSync('public')) walk('public');
      const files = ['./', './index.html', ...Object.keys(bundle).filter((f) => !f.endsWith('.map')), ...publicFiles].map((f) => (f === './' ? f : `./${f}`));
      const h = crypto.createHash('sha256');
      Object.values(bundle).forEach((b) => h.update(b.code || b.source?.toString?.() || b.fileName));
      publicFiles.forEach((f) => h.update(fs.readFileSync(path.join('public', f))));
      const hash = h.digest('hex').slice(0, 12);
      const tpl = fs.readFileSync('src/sw-template.js', 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: tpl.replace('__VERSION__', hash).replace('__PRECACHE__', JSON.stringify([...new Set(files)], null, 1)) });
    },
  };
}

/**
 * MapLibre 6 is shipped as ES modules that load a web worker from next to
 * themselves, so its files are served unbundled from vendor/maplibre/.
 */
function vendorMaplibre() {
  const copy = () => {
    const src = 'node_modules/maplibre-gl/dist';
    const dest = 'public/vendor/maplibre';
    fs.mkdirSync(dest, { recursive: true });
    ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css'].forEach((f) => fs.copyFileSync(path.join(src, f), path.join(dest, f)));
    fs.copyFileSync('node_modules/maplibre-gl/LICENSE.txt', path.join(dest, 'LICENSE.txt'));
  };
  return { name: 'vendor-maplibre', buildStart: copy, configureServer: copy };
}

/**
 * Content-Security-Policy for the built app: scripts only from the app itself,
 * and network requests only to the Sheet's Apps Script, Open-Meteo and
 * OpenFreeMap. Even injected code could not send trip data anywhere else.
 * TRIP_CSP_EXTRA_CONNECT adds origins for local testing (the mock Sheet).
 */
function contentSecurityPolicy() {
  const connect = [
    "'self'",
    'https://script.google.com', 'https://script.googleusercontent.com',
    'https://api.open-meteo.com', 'https://archive-api.open-meteo.com',
    'https://tiles.openfreemap.org',
    ...(process.env.TRIP_CSP_EXTRA_CONNECT || '').split(/\s+/).filter(Boolean),
  ];
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'trip-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`),
  };
}

export default defineConfig({
  base: './',
  plugins: [vendorMaplibre(), contentSecurityPolicy(), serviceWorker()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/unit/**/*.test.mjs'] },
});
