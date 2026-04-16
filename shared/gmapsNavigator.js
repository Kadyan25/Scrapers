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

  // Wait for the results panel to appear
  try {
    await page.waitForSelector('[role="feed"]', { timeout: 15000 });
  } catch {
    // Some queries open a single listing instead of a list — caller handles this
  }

  return { page, context };
}

/**
 * Scroll the left results panel until no new listings load or max 120 reached.
 * Returns an array of locators for each result card.
 */
async function scrollResults(page) {
  const feed = page.locator('[role="feed"]');

  let previousCount = 0;
  let stableRounds = 0;

  while (stableRounds < 3) {
    // Scroll the feed panel to the bottom
    await feed.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await scrollDelay();

    const currentCount = await page.locator('[role="feed"] > div[jsaction]').count();
    if (currentCount >= 120) break;

    if (currentCount === previousCount) {
      staleRounds++;
    } else {
      stableRounds = 0;
    }

    // Check for "end of list" marker
    const endMarker = await page
      .locator("text=/You've reached the end of the list/i")
      .count();
    if (endMarker > 0) break;

    previousCount = currentCount;
  }

  return page.locator('[role="feed"] > div[jsaction]').all();
}

/**
 * Extract basic info from a result card in the list panel.
 * Uses attribute selectors to survive Google DOM reshuffles.
 * @param {import('playwright').Locator} card
 * @returns {{ name, hasWebsite, rating, reviewCount, category }}
 */
async function extractListingBasic(card) {
  const name = await card.locator('[class*="fontHeadlineSmall"], [jsan*="t.q"] span').first().textContent().catch(() => null);

  // Website indicator — the card shows a globe/link icon when a website is present
  const hasWebsite = (await card.locator('a[data-item-id="authority"], [data-tooltip="Open website"], [aria-label*="website" i]').count()) > 0;

  const ratingText = await card.locator('[aria-label*="stars" i], [aria-label*="star" i]').first().getAttribute('aria-label').catch(() => null);
  const rating = ratingText ? parseFloat(ratingText.match(/[\d.]+/)?.[0]) || null : null;

  const reviewText = await card.locator('[aria-label*="review" i]').first().getAttribute('aria-label').catch(() => null);
  const reviewCount = reviewText ? parseInt(reviewText.replace(/\D/g, ''), 10) || null : null;

  const category = await card.locator('[jsan*="category"], .fontBodyMedium > span').first().textContent().catch(() => null);

  return {
    name: name?.trim() || null,
    hasWebsite,
    rating,
    reviewCount,
    category: category?.trim() || null,
  };
}

/**
 * Click a result card and wait for the detail panel to open.
 * @param {import('playwright').Locator} card
 * @param {import('playwright').Page} page
 */
async function clickListing(card, page) {
  await card.click();
  await humanDelay(1200, 2500);
  // Wait for the detail panel heading
  await page.waitForSelector('[role="main"] h1, [data-attrid="title"] h1', { timeout: 10000 }).catch(() => {});
}

/**
 * Extract detailed fields from the open detail panel.
 * All selectors use data-item-id or aria attributes — avoid class names.
 * @returns {{ name, phone, address, website, hours }}
 */
async function extractListingDetail(page) {
  // Name from detail panel heading
  const name = await page
    .locator('[role="main"] h1')
    .first()
    .textContent()
    .catch(() => null);

  // Phone — data-item-id starts with "phone:" is the most stable
  const phoneEl = page.locator('[data-item-id^="phone:"]').first();
  const phoneAriaLabel = await phoneEl.getAttribute('aria-label').catch(() => null);
  const phoneText = phoneAriaLabel
    ? phoneAriaLabel.replace(/phone:/i, '').trim()
    : await phoneEl.textContent().catch(() => null);
  const phone = cleanPhone(phoneText) || null;

  // Address — uses data-item-id="address"
  const addressEl = page.locator('[data-item-id="address"]').first();
  const address = await addressEl.textContent().catch(() => null);

  // Website — the "authority" link
  const websiteEl = page.locator('a[data-item-id="authority"]').first();
  const website = await websiteEl.getAttribute('href').catch(() => null);

  // Hours summary — not always present
  const hoursEl = page.locator('[aria-label*="hour" i][data-item-id*="oh"], button[data-item-id*="hours"]').first();
  const hours = await hoursEl.getAttribute('aria-label').catch(() => null);

  return {
    name: name?.trim() || null,
    phone,
    address: address?.trim() || null,
    website: isValidUrl(website) ? website : null,
    hours: hours?.trim() || null,
  };
}

module.exports = { searchMaps, scrollResults, extractListingBasic, clickListing, extractListingDetail };
