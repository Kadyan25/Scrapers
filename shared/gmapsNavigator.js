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

  // Wait for the results list or a single listing detail to appear
  await page
    .waitForSelector('[role="feed"], [data-item-id="address"]', { timeout: 15000 })
    .catch(() => {});

  return { page, context };
}

/**
 * Scroll the left results panel until no new listings load or max 120 reached.
 * Returns an array of Locators, one per result card.
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

    // Check for end-of-list marker
    const endMarker = await page
      .locator("text=/You've reached the end of the list/i")
      .count();
    if (endMarker > 0) break;

    previousCount = currentCount;
  }

  return page.locator('[role="article"]').all();
}

/**
 * Extract basic info from a result card in the list panel.
 * @param {import('playwright').Locator} card
 * @returns {{ name, hasWebsite, rating, category }}
 */
async function extractListingBasic(card) {
  // Name — article's own aria-label is the most stable source
  const name = await card.getAttribute('aria-label').catch(() => null);

  // Website indicator — card has a "Visit … website" link when one exists
  const hasWebsite =
    (await card.locator('a[aria-label^="Visit"]').count()) > 0;

  // Rating — "4.6 stars" in the aria-label
  const ratingLabel = await card
    .locator('span[role="img"][aria-label*="stars"]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null);
  const rating = ratingLabel
    ? parseFloat(ratingLabel.match(/[\d.]+/)?.[0]) || null
    : null;

  // Category — first non-numeric, non-separator text inside .W4Efsd spans
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
 * Click a result card and wait for the detail panel to load.
 * Captures the current address first so we can detect when the panel updates.
 * @param {import('playwright').Locator} card
 * @param {import('playwright').Page} page
 */
async function clickListing(card, page) {
  // Snapshot the current address so we know when the new listing has loaded
  const prevAddress = await page
    .locator('[data-item-id="address"]')
    .first()
    .textContent()
    .catch(() => '');

  await card.locator('a.hfpxzc').first().click();
  await humanDelay(800, 1500);

  if (prevAddress.trim()) {
    // Wait until the address text changes — guarantees the panel refreshed
    await page
      .waitForFunction(
        (prev) => {
          const el = document.querySelector('[data-item-id="address"]');
          return el && el.textContent.trim() !== prev;
        },
        prevAddress.trim(),
        { timeout: 15000 }
      )
      .catch(() => {});
  } else {
    // First listing — just wait for the element to appear
    await page
      .waitForSelector('[data-item-id="address"]', { timeout: 12000 })
      .catch(() => {});
  }

  await humanDelay(400, 800); // brief settle after panel loads
}

/**
 * Extract fields from the open detail panel.
 * Uses data-item-id attribute selectors throughout — no class names.
 * @returns {{ name, phone, address, website, reviewCount, hours }}
 */
async function extractListingDetail(page) {
  // Name — page title is "[Business Name] - Google Maps" for place pages
  const pageTitle = await page.title().catch(() => '');
  const name = pageTitle
    ? pageTitle.replace(/\s*[-–—]\s*Google Maps.*$/i, '').trim() || null
    : null;

  // Review count — available in the detail panel as "371 reviews" aria-label
  const reviewLabel = await page
    .locator('span[aria-label$=" reviews"]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null);
  const reviewCount = reviewLabel
    ? parseInt(reviewLabel.replace(/\D/g, ''), 10) || null
    : null;

  // Phone — data-item-id starts with "phone:"
  const phoneEl = page.locator('[data-item-id^="phone:"]').first();
  const phoneAriaLabel = await phoneEl.getAttribute('aria-label').catch(() => null);
  const rawPhone = phoneAriaLabel
    ? phoneAriaLabel.replace(/^Phone:\s*/i, '').trim()
    : await phoneEl.textContent().catch(() => null);
  const phone = cleanPhone(rawPhone) || null;

  // Address — aria-label has "Address: …" prefix
  const addressEl = page.locator('[data-item-id="address"]').first();
  const addressLabel = await addressEl.getAttribute('aria-label').catch(() => null);
  const address = addressLabel
    ? addressLabel.replace(/^Address:\s*/i, '').trim()
    : await addressEl.textContent().catch(() => null);

  // Website — authority link href
  const websiteEl = page.locator('a[data-item-id="authority"]').first();
  const websiteHref = await websiteEl.getAttribute('href').catch(() => null);
  const website = isValidUrl(websiteHref) ? websiteHref : null;

  // Hours — not always present
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

module.exports = { searchMaps, scrollResults, extractListingBasic, clickListing, extractListingDetail };
