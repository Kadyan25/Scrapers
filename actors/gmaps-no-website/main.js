'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify } = require('../../shared/browser');
const { searchMaps, scrollResults, extractListingBasic, clickListing, extractListingDetail } = require('../../shared/gmapsNavigator');
const { humanDelay } = require('../../shared/delays');

/**
 * Run the GMaps No-Website scraper.
 * Only processes and returns listings that have NO website — high-intent leads.
 *
 * @param {object} input
 * @param {string}   input.query
 * @param {string[]} [input.geoTiles]
 * @param {number}   [input.maxResults=120]
 * @param {Function} pushResult
 * @param {string}   [proxyUrl]
 */
async function run({ query, geoTiles, maxResults = 120, pushResult, proxyUrl }) {
  const queries = geoTiles && geoTiles.length > 0 ? geoTiles : [query];
  const seen = new Set();

  const browser = proxyUrl ? await launchApify(proxyUrl) : await launchLocal();

  try {
    for (const q of queries) {
      console.log(`[gmaps-no-website] Searching: ${q}`);
      const { page, context } = await searchMaps(q, browser);

      let listings;
      try {
        listings = await scrollResults(page);
      } catch (err) {
        console.warn(`[gmaps-no-website] scrollResults failed for "${q}": ${err.message}`);
        await context.close();
        continue;
      }

      const limit = Math.min(listings.length, maxResults);
      console.log(`[gmaps-no-website] Found ${listings.length} listings, scanning for no-website`);

      for (let i = 0; i < limit; i++) {
        try {
          const basic = await extractListingBasic(listings[i]);

          // Core filter — skip anything with a website
          if (basic.hasWebsite) continue;

          const dedupeKey = `${basic.name}|${basic.category}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          await clickListing(listings[i], page);
          const detail = await extractListingDetail(page);

          const record = {
            name: basic.name || detail.name,
            phone: detail.phone,
            address: detail.address,
            category: basic.category,
            rating: basic.rating,
            reviewCount: detail.reviewCount,
            scrapedAt: new Date().toISOString(),
          };

          await pushResult(record);
          console.log(`[gmaps-no-website] No-website lead: ${record.name}`);

          await humanDelay(800, 1800);
        } catch (err) {
          console.warn(`[gmaps-no-website] Listing ${i} failed: ${err.message}`);
        }
      }

      await context.close();
      await humanDelay(1500, 3000);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { run };
