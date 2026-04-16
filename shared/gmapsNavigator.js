'use strict';

const { newContext } = require('./browser');
const { humanDelay, scrollDelay, pageLoadDelay } = require('./delays');
const { cleanPhone, isValidUrl } = require('./utils');

/**
 * Open Google Maps and search for a query.
 * Returns { page, context } — caller must close context when done.
 */
async function searchMaps(query, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();

  const encodedQuery = encodeURIComponent(query);
  await page.goto(`https://www.google.com/maps/search/${encodedQuery}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await pageLoadDelay();

  await page
    .waitForSelector('[role="feed"], [data-item-id="address"]', { timeout: 15000 })
    .catch(() => {});

  return { page, context };
}

/**
 * Scroll the results panel until stable or 120 listings loaded.
 * Returns an array of Locators, one per card.
 */
async function scrollResults(page) {
  const feed = page.locator('[role="feed"]');

  let previousCount = 0;
  let stableRounds = 0;

  while (stableRounds < 3) {
    await feed.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await scrollDelay();

    const currentCount = await page.locator('[role="article"]').count();
    if (currentCount >= 120) break;

    if (currentCount === previousCount) {
      stableRounds++;
    } else {
      stableRounds = 0;
    }

    const endMarker = await page
      .locator("text=/You've reached the end of the list/i")
      .count();
    if (endMarker > 0) break;

    previousCount = currentCount;
  }

  return page.locator('[role="article"]').all();
}

/**
 * Walk all result cards and collect { basic, href } while the list page is
 * still open. Call this before closing the search context.
 *
 * @param {import('playwright').Locator[]} listings
 * @param {number} limit
 * @returns {Promise<Array<{ basic: object, href: string|null }>>}
 */
async function collectCardData(listings, limit) {
  const results = [];
  for (let i = 0; i < Math.min(listings.length, limit); i++) {
    const card = listings[i];
    const basic = await extractListingBasic(card);
    const href = await card
      .locator('a.hfpxzc')
      .first()
      .getAttribute('href')
      .catch(() => null);
    results.push({ basic, href });
  }
  return results;
}

/**
 * Extract basic info from a result card in the list panel.
 * @param {import('playwright').Locator} card
 * @returns {{ name, hasWebsite, rating, category }}
 */
async function extractListingBasic(card) {
  const name = await card.getAttribute('aria-label').catch(() => null);

  const hasWebsite =
    (await card.locator('a[aria-label^="Visit"]').count()) > 0;

  const ratingLabel = await card
    .locator('span[role="img"][aria-label*="stars"]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null);
  const rating = ratingLabel
    ? parseFloat(ratingLabel.match(/[\d.]+/)?.[0]) || null
    : null;

  const w4Texts = await card
    .locator('.W4Efsd span span')
    .allTextContents()
    .catch(() => []);
  const category =
    w4Texts.find(
      (t) => t.trim() && !/^[\d.]+$/.test(t.trim()) && t.trim() !== '·'
    ) || null;

  return {
    name: name?.trim() || null,
    hasWebsite,
    rating,
    category: category?.trim() || null,
  };
}

/**
 * Navigate a page directly to a place URL and wait for the detail panel.
 * Using direct navigation (instead of click) avoids stale locator issues
 * when iterating through many listings.
 *
 * @param {string} href  — the place URL from a.hfpxzc
 * @param {import('playwright').Page} page
 */
async function navigateToListing(href, page) {
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page
    .waitForSelector('[data-item-id="address"]', { timeout: 12000 })
    .catch(() => {});
  await humanDelay(300, 600);
}

/**
 * Extract fields from the open detail panel.
 * Uses data-item-id attribute selectors — no class names.
 * @returns {{ name, phone, address, website, reviewCount, hours }}
 */
async function extractListingDetail(page) {
  // Name from page title: "[Business Name] - Google Maps"
  const pageTitle = await page.title().catch(() => '');
  const name = pageTitle
    ? pageTitle.replace(/\s*[-–—]\s*Google Maps.*$/i, '').trim() || null
    : null;

  const reviewLabel = await page
    .locator('span[aria-label$=" reviews"]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null);
  const reviewCount = reviewLabel
    ? parseInt(reviewLabel.replace(/\D/g, ''), 10) || null
    : null;

  const phoneEl = page.locator('[data-item-id^="phone:"]').first();
  const phoneAriaLabel = await phoneEl.getAttribute('aria-label').catch(() => null);
  const rawPhone = phoneAriaLabel
    ? phoneAriaLabel.replace(/^Phone:\s*/i, '').trim()
    : await phoneEl.textContent().catch(() => null);
  const phone = cleanPhone(rawPhone) || null;

  const addressEl = page.locator('[data-item-id="address"]').first();
  const addressLabel = await addressEl.getAttribute('aria-label').catch(() => null);
  const address = addressLabel
    ? addressLabel.replace(/^Address:\s*/i, '').trim()
    : await addressEl.textContent().catch(() => null);

  const websiteEl = page.locator('a[data-item-id="authority"]').first();
  const websiteHref = await websiteEl.getAttribute('href').catch(() => null);
  const website = isValidUrl(websiteHref) ? websiteHref : null;

  const hoursEl = page
    .locator('[data-item-id*="oh"] [aria-label*="hour" i], button[aria-expanded][aria-label*="hour" i]')
    .first();
  const hours = await hoursEl.getAttribute('aria-label').catch(() => null);

  return {
    name: name?.trim() || null,
    phone,
    address: address?.trim() || null,
    website,
    reviewCount,
    hours: hours?.trim() || null,
  };
}

module.exports = {
  searchMaps,
  scrollResults,
  collectCardData,
  extractListingBasic,
  navigateToListing,
  extractListingDetail,
};
