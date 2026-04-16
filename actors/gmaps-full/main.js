'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify, newContext } = require('../../shared/browser');
const { searchMaps, scrollResults, collectCardData, navigateToListing, extractListingDetail } = require('../../shared/gmapsNavigator');
const { scrapeEmailFromWebsite } = require('../../shared/websiteScraper');
const { humanDelay } = require('../../shared/delays');

/**
 * Run the GMaps Full scraper.
 *
 * Phase 1 — search + scroll on the list page, collect basic data + place URLs.
 * Phase 2 — navigate directly to each place URL for detail extraction.
 *
 * Direct navigation avoids stale locator issues that occur when clicking
 * cards after the search page has navigated away.
 *
 * @param {object}   input
 * @param {string}   input.query
 * @param {string[]} [input.geoTiles]
 * @param {number}   [input.maxResults=120]
 * @param {Function} pushResult
 * @param {string}   [proxyUrl]
 */
async function run({ query, geoTiles, maxResults = 120, pushResult, proxyUrl }) {
  const queries = geoTiles && geoTiles.length > 0 ? geoTiles : [query];
  const seen = new Set(); // within-run dedup by name

  const browser = proxyUrl ? await launchApify(proxyUrl) : await launchLocal();

  try {
    for (const q of queries) {
      console.log(`[gmaps-full] Searching: ${q}`);

      // ── Phase 1: collect card data from the list page ──────────────────────
      const { page: listPage, context: listContext } = await searchMaps(q, browser);

      let listings;
      try {
        listings = await scrollResults(listPage);
      } catch (err) {
        console.warn(`[gmaps-full] scrollResults failed for "${q}": ${err.message}`);
        await listContext.close();
        continue;
      }

      console.log(`[gmaps-full] Found ${listings.length} listings, collecting up to ${maxResults}`);
      const cardData = await collectCardData(listings, maxResults);
      await listContext.close(); // list page no longer needed

      // ── Phase 2: navigate to each place URL for detail ─────────────────────
      const detailContext = await newContext(browser);
      const detailPage = await detailContext.newPage();

      try {
        for (let i = 0; i < cardData.length; i++) {
          const { basic, href } = cardData[i];
          if (!href) continue;

          try {
            const dedupeKey = `${basic.name}|${basic.category}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            await navigateToListing(href, detailPage);
            const detail = await extractListingDetail(detailPage);

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
            console.log(`[gmaps-full] ${i + 1}/${cardData.length} — ${record.name}`);

            await humanDelay(800, 1500);
          } catch (err) {
            console.warn(`[gmaps-full] Listing ${i + 1} failed: ${err.message}`);
          }
        }
      } finally {
        await detailContext.close();
      }

      await humanDelay(1500, 3000);
    }
  } finally {
    await browser.close();
  }
}

module.exports = { run };
