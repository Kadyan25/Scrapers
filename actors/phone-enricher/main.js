'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify, newContext } = require('../../shared/browser');
const { scrapePhoneFromWebsite } = require('../../shared/websiteScraper');
const { searchMaps, extractListingDetail } = require('../../shared/gmapsNavigator');
const { extractPhones, cleanPhone, isValidUrl } = require('../../shared/utils');
const { humanDelay, pageLoadDelay } = require('../../shared/delays');

/**
 * Step 2: Reverse-lookup the business on Google Maps by name.
 * Clicks the first result and pulls the phone from the detail panel.
 */
async function scrapePhoneFromMaps(businessName, browser) {
  const { page, context } = await searchMaps(businessName, browser);
  try {
    // For a name search, Maps often opens the detail panel directly
    await humanDelay(1500, 2500);
    const detail = await extractListingDetail(page);
    return detail.phone || null;
  } finally {
    await context.close();
  }
}

/**
 * Step 3: Google Search for "[businessName] phone number".
 * Extracts phone from the knowledge panel or page text.
 */
async function scrapePhoneFromGoogle(businessName, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    const query = encodeURIComponent(`${businessName} phone number`);
    await page.goto(`https://www.google.com/search?q=${query}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await pageLoadDelay();

    // Knowledge panel phone — most reliable
    const kpPhone = await page
      .locator('[data-attrid*="phone"], [data-attrid="ss:/webfacts:phone_number"]')
      .first()
      .textContent()
      .catch(() => null);

    if (kpPhone) {
      const cleaned = cleanPhone(kpPhone);
      if (cleaned) return cleaned;
    }

    // Fallback: scan visible text for phone patterns
    const bodyText = await page.evaluate(() => document.body.innerText);
    const phones = extractPhones(bodyText);
    return phones[0] || null;
  } finally {
    await context.close();
  }
}

/**
 * Run the Phone Enricher actor.
 *
 * @param {object} input
 * @param {object[]} input.records        — array of { businessName?, website?, email? }
 * @param {Function} pushResult
 * @param {string}   [proxyUrl]
 */
async function run({ records, pushResult, proxyUrl }) {
  const browser = proxyUrl ? await launchApify(proxyUrl) : await launchLocal();

  try {
    for (const record of records) {
      const { businessName, website, email } = record;

      if (!businessName && !website && !email) {
        console.warn('[phone-enricher] Skipping record with no usable fields');
        continue;
      }

      let phone = null;
      let enrichmentStatus = 'not_found';

      // Step 1 — website scrape
      if (!phone && isValidUrl(website)) {
        console.log(`[phone-enricher] Step 1 — website: ${website}`);
        phone = await scrapePhoneFromWebsite(website, browser).catch(() => null);
        if (phone) enrichmentStatus = 'found_via_website';
      }

      // Step 2 — GMaps reverse lookup
      if (!phone && businessName) {
        console.log(`[phone-enricher] Step 2 — Maps: ${businessName}`);
        phone = await scrapePhoneFromMaps(businessName, browser).catch(() => null);
        if (phone) enrichmentStatus = 'found_via_maps';
      }

      // Step 3 — Google Search
      if (!phone && businessName) {
        console.log(`[phone-enricher] Step 3 — Google: ${businessName}`);
        phone = await scrapePhoneFromGoogle(businessName, browser).catch(() => null);
        if (phone) enrichmentStatus = 'found_via_google';
      }

      const result = {
        ...record,
        phone,
        enrichmentStatus,
        enrichedAt: new Date().toISOString(),
      };

      await pushResult(result);
      console.log(`[phone-enricher] ${businessName || website} → ${phone || 'not found'} (${enrichmentStatus})`);

      await humanDelay(1000, 2000);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { run };
