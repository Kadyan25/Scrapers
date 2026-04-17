'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify } = require('../../shared/browser');
const { scrapePhoneFromWebsite, scrapePhoneFromGoogle } = require('../../shared/websiteScraper');
const { searchMaps, extractListingDetail } = require('../../shared/gmapsNavigator');
const { isValidUrl } = require('../../shared/utils');
const { humanDelay } = require('../../shared/delays');

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
 * Run the Phone Enricher actor.
 *
 * @param {object} input
 * @param {object[]} input.records        — array of { businessName?, website?, email? }
 * @param {Function} pushResult
 * @param {string}   [proxyUrl]
 */
async function run({ records, includeSocial = false, pushResult, proxyUrl }) {
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
      const t = Date.now();

      // Step 1 — website HTTP fetch (free: no browser, no proxy)
      // If website is provided, always try this first before opening any browser.
      if (!phone && isValidUrl(website)) {
        console.log(`[phone-enricher] Step 1 — website: ${website}`);
        phone = await scrapePhoneFromWebsite(website, browser, { includeSocial }).catch(() => null);
        if (phone) enrichmentStatus = 'found_via_website';
      }

      // Step 2 — GMaps lookup (costs proxy — only runs if website didn't have phone)
      if (!phone && businessName) {
        console.log(`[phone-enricher] Step 2 — Maps: ${businessName}`);
        phone = await scrapePhoneFromMaps(businessName, browser).catch(() => null);
        if (phone) enrichmentStatus = 'found_via_maps';
      }

      // Step 3 — Google Search (last resort)
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

      const elapsed = ((Date.now() - t) / 1000).toFixed(1);
      await pushResult(result);
      console.log(`[phone-enricher] ${businessName || website} → ${phone || 'not found'} (${enrichmentStatus}, ${elapsed}s)`);

      await humanDelay(1000, 2000);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { run };

if (require.main === module) {
  const { Actor } = require('apify');
  Actor.main(async () => {
    const input = await Actor.getInput();
    const proxyConfiguration = await Actor.createProxyConfiguration({
      groups: ['RESIDENTIAL'],
      countryCode: 'US',
    });
    const proxyUrl = await proxyConfiguration.newUrl();
    await run({
      ...input,
      pushResult: (record) => Actor.pushData(record),
      proxyUrl,
    });
  });
}
