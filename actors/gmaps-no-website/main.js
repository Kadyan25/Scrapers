'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify, newContext } = require('../../shared/browser');
const { searchMaps, scrollResults, collectCardData, navigateToListing, extractListingDetail } = require('../../shared/gmapsNavigator');
const { humanDelay } = require('../../shared/delays');

/**
 * Run the GMaps No-Website scraper.
 * Only returns listings that have NO website — high-intent leads.
 *
 * Phase 1 — search + scroll, collect basic data + place URLs.
 * Phase 2 — navigate directly to each no-website listing for detail extraction.
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
  const seen = new Set();

  const browser = proxyUrl ? await launchApify(proxyUrl) : await launchLocal();

  try {
    for (const q of queries) {
      console.log(`[gmaps-no-website] Searching: ${q}`);

      // ── Phase 1: collect card data, filter to no-website only ──────────────
      const { page: listPage, context: listContext } = await searchMaps(q, browser);

      let listings;
      try {
        listings = await scrollResults(listPage);
      } catch (err) {
        console.warn(`[gmaps-no-website] scrollResults failed for "${q}": ${err.message}`);
        await listContext.close();
        continue;
      }

      console.log(`[gmaps-no-website] Found ${listings.length} listings, collecting card data`);
      const allCards = await collectCardData(listings, maxResults);
      await listContext.close();

      // Filter to no-website listings only — do this before opening detail pages
      const noWebsiteCards = allCards.filter(({ basic }) => !basic.hasWebsite);
      console.log(`[gmaps-no-website] ${noWebsiteCards.length} no-website leads to process`);

      if (noWebsiteCards.length === 0) {
        await humanDelay(1500, 3000);
        continue;
      }

      // ── Phase 2: navigate to each no-website listing for detail ────────────
      const detailContext = await newContext(browser);
      const detailPage = await detailContext.newPage();

      try {
        for (let i = 0; i < noWebsiteCards.length; i++) {
          const { basic, href } = noWebsiteCards[i];
          if (!href) continue;

          try {
            const dedupeKey = `${basic.name}|${basic.category}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const t = Date.now();
            await navigateToListing(href, detailPage);
            const detail = await extractListingDetail(detailPage);
            const elapsed = ((Date.now() - t) / 1000).toFixed(1);

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
            console.log(`[gmaps-no-website] ${i + 1}/${noWebsiteCards.length} — ${record.name} (${elapsed}s)`);

            await humanDelay(800, 1500);
          } catch (err) {
            console.warn(`[gmaps-no-website] Listing ${i + 1} failed: ${err.message}`);
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
