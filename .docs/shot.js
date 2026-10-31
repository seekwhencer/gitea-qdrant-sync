import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const OUT = process.env.OUT_DIR || '.docs/screenshots';
const VIEWPORT = { width: 1300, height: 1000 };
const ZOOM = '1.25'; // "zoom in twice": 100% -> 110% -> 125%
const QUESTION = 'Sage mir etwas über das Model Context Protokoll';

const log = (...a) => console.log('[shot]', ...a);

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

async function scrollToTop(page) {
  await page.evaluate(() => {
    // Override global "scroll-behavior: smooth" so the jump is instant.
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  });
  await page.waitForTimeout(150);
}

// Apply the "zoom in twice" (CSS zoom) on every new document automatically.
async function applyZoom(context) {
  await context.addInitScript((z) => {
    const apply = () => { document.documentElement.style.zoom = z; };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }, ZOOM);
}

async function shootIndex(page) {
  await goto(page, BASE + '/');
  await page.waitForSelector('.layout__sidebar, .page__title, main, body', { timeout: 15000 });
  await page.waitForTimeout(900);
  await scrollToTop(page);
  const file = path.join(OUT, 'dashboard.png');
  await page.screenshot({ path: file, fullPage: true });
  log('index', file);
}

async function recordSearchVideo(browser) {
  // Dedicated context with video recording enabled. The video is flushed to
  // disk when the context is closed.
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: VIEWPORT.width, height: VIEWPORT.height } },
  });
  await applyZoom(context);

  const page = await context.newPage();
  await goto(page, BASE + '/');
  await page.waitForSelector('.search-bar__input', { timeout: 15000 });
  await page.waitForTimeout(900);
  await scrollToTop(page);

  // Type the question into the search bar and submit it.
  const input = page.locator('.search-bar__input');
  await input.click();
  await input.fill(QUESTION);
  await page.waitForTimeout(400);
  await input.press('Enter');

  // The input is disabled while the search is pending. Wait for that state to
  // confirm the submission was registered.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.search-bar__input');
      return el !== null && el.disabled === true;
    },
    null,
    { timeout: 15000 }
  );

  // Screenshot once the answer has been streaming for 4 seconds — mid-stream,
  // not at the end of the output.
  await page.waitForSelector('.search-results__answer', { timeout: 30000 });
  await page.waitForTimeout(4000);
  const answerFile = path.join(OUT, 'search-answer.png');
  await page.screenshot({ path: answerFile, fullPage: true });
  log('answer', answerFile);

  // Wait for the input to re-enable once the streamed answer is complete.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.search-bar__input');
      return el !== null && el.disabled === false;
    },
    null,
    { timeout: 120000 }
  );
  // Let the final answer settle so it is captured in the video.
  await page.waitForTimeout(800);

  // Close the context so the video is saved, then rename it to search.webm.
  const video = page.video();
  if (!video) throw new Error('Video recording was not enabled for this page.');
  await context.close();
  const videoPath = await video.path();
  const target = path.join(OUT, 'search.webm');
  fs.renameSync(videoPath, target);
  log('video', target);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  // Dashboard screenshot (existing behavior).
  {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await applyZoom(context);
    const page = await context.newPage();

    // Verify zoom is applied.
    await goto(page, BASE + '/');
    await page.waitForTimeout(500);
    const zoomCheck = await page.evaluate(() => getComputedStyle(document.documentElement).zoom);
    log(`zoom check: rootZoom=${zoomCheck} (expected ${ZOOM})`);
    if (zoomCheck !== ZOOM) throw new Error(`Zoom not applied: got ${zoomCheck}, expected ${ZOOM}`);

    await shootIndex(page);
    await context.close();
  }

  // Search video (new).
  await recordSearchVideo(browser);

  await browser.close();

  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.png') || f.endsWith('.webm')).sort();
  fs.writeFileSync(path.join(OUT, 'manifest.txt'), files.join('\n') + '\n');
  log(`DONE. ${files.length} artifact(s) in ${OUT}`);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
