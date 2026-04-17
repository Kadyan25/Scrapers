'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Launch a visible browser for local development. No proxy.
 */
async function launchLocal() {
  const headless = process.env.HEADLESS === 'true';
  const browser = await chromium.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return browser;
}

/**
 * Launch a headless browser for Apify production runs.
 * @param {string} proxyUrl — Apify residential proxy URL
 */
async function launchApify(proxyUrl) {
  const parsed = new URL(proxyUrl);
  const proxyConfig = {
    server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
  const browser = await chromium.launch({
    headless: true,
    proxy: proxyConfig,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return browser;
}

/**
 * Create a new browser context with a random UA and sensible viewport.
 */
async function newContext(browser) {
  return browser.newContext({
    userAgent: randomUA(),
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
}

// Third-party domains that add bandwidth without affecting scraped data.
const BLOCKED_DOMAINS = [
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'stats.g.doubleclick.net',
  'www.google-analytics.com',
  'analytics.google.com',
];

/**
 * Block images, fonts, media, and third-party analytics/ad scripts.
 * Map tiles alone are 6-8MB per Maps page; analytics add more with zero benefit.
 * Call this once on every new page before navigating.
 */
async function blockHeavyResources(page) {
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      return route.abort();
    }
    const url = route.request().url();
    if (BLOCKED_DOMAINS.some((d) => url.includes(d))) {
      return route.abort();
    }
    route.continue();
  });
}

module.exports = { launchLocal, launchApify, newContext, blockHeavyResources };
