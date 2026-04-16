'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify } = require('../../shared/browser');
const { searchMaps, scrollResults, extractListingBasic, clickListing, extractListingDetail } = require('../../shared/gmapsNavigator');
const { scrapeEmailFromWebsite } = require('../../shared/websiteScraper');
const { humanDelay } = require('../../shared/delays');

/**
 * Run the GMaps Full scraper.
 * @param {object} input
 * @param {string}   input.query       — e.g. "auto body shop Brooklyn NY"
 * @param {string[]} [input.geoTiles]  — array of queries for geo-tiling
 * @param {number}   [input.maxResults=120]
 * @param {Function} pushResult        — callback(record) to store output
 * @param {string}   [proxyUrl]        — Apify proxy URL; omit for local runs
 */
async function run({ query, geoTiles, maxResults = 120, pushResult, proxyUrl }) {
  const queries = geoTiles && geoTiles.length > 0 ? geoTiles : [query];
  const seen = new Set(); // deduplicate by name+address

  const browser = proxyUrl ? await launchApify(proxyUrl) : await launchLocal();

  try {
    for (const q of queries) {
      console.log(`[gmaps-full] Searching: ${q}`);
      const { page, context } = await searchMaps(q, browser);

      let listings;
      try {
        listings = await scrollResults(page);
      } catch (err) {
        console.warn(`[gmaps-full] scrollResults failed for "${q}": ${err.message}`);
        await context.close();
        continue;
      }

      const limit = Math.min(listings.length, maxResults);
      console.log(`[gmaps-full] Found ${listings.length} listings, processing up to ${limit}`);

      for (let i = 0; i < limit; i++) {
        try {
          const basic = await extractListingBasic(listings[i]);
          const dedupeKey = `${basic.name}|${basic.category}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          await clickListing(listings[i], page);
          const detail = await extractListingDetail(page);

          let email = null;
          if (detail.website) {
            email = await scrapeEmailFromWebsite(detail.website, browser);
          }

          const record = {
            name: basic.name || detail.name,
            phone: detail.phone,
            address: detail.address,
            website: detail.website,
            email,
            category: basic.category,
            rating: basic.rating,
            reviewCount: detail.reviewCount,
            hasEmail: !!email,
            scrapedAt: new Date().toISOString(),
          };

          await pushResult(record);
          console.log(`[gmaps-full] ${i + 1}/${limit} — ${record.name}`);

          await humanDelay(800, 1800);
        } catch (err) {
          console.warn(`[gmaps-full] Listing ${i} failed: ${err.message}`);
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
