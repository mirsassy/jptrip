// Renders the app icons (a torii gate under a red sun) to PNG with Playwright's Chromium.
import { chromium } from '@playwright/test';

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f6f1e7"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">
    <circle cx="256" cy="190" r="118" fill="#b7282e"/>
    <rect x="96" y="250" width="320" height="30" rx="8" fill="#1d1b19"/>
    <path d="M70 232 Q256 196 442 232 L436 252 Q256 222 76 252 Z" fill="#1d1b19"/>
    <rect x="132" y="300" width="248" height="22" fill="#1d1b19"/>
    <rect x="146" y="262" width="30" height="190" fill="#1d1b19"/>
    <rect x="336" y="262" width="30" height="190" fill="#1d1b19"/>
    <rect x="243" y="280" width="26" height="42" fill="#1d1b19"/>
  </g>
</svg>`;

const out = [
  ['public/icons/icon-192.png', 192, 0],
  ['public/icons/icon-512.png', 512, 0],
  ['public/icons/apple-touch-icon.png', 180, 0],
  ['public/icons/icon-maskable-512.png', 512, 0.2],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
for (const [file, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg(pad)).toString('base64')}" width="${size}" height="${size}">`);
  await page.screenshot({ path: file, omitBackground: false });
  console.log('wrote', file);
}
await browser.close();
