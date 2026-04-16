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
 * Speed optimisation: website email scraping for listing N runs in the
 * background while we navigate to listing N+1. Both resolve via Promise.all
 * at the start of each iteration, so the slower one (website scrape) hides
 * the faster one (GMaps navigation) rather than stacking sequentially.
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
      await listContext.close();

      // ── Phase 2: navigate to each place URL, pipeline website scraping ─────
      const detailContext = await newContext(browser);
      const detailPage = await detailContext.newPage();

      try {
        // pendingEmail: the website scrape for the previous listing, running in background.
        // pendingRecord: the previous listing's record, waiting for its email before push.
        let pendingEmail = Promise.resolve(null);
        let pendingRecord = null;

        for (let i = 0; i < cardData.length; i++) {
          const { basic, href } = cardData[i];
          if (!href) continue;

          const dedupeKey = `${basic.name}|${basic.category}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          try {
            // Navigate to this listing AND resolve previous email simultaneously.
            // Website scraping (slow) runs concurrently with GMaps navigation (fast),
            // so navigation time is hidden inside the scrape time.
            const [prevEmail] = await Promise.all([
              pendingEmail,
              navigateToListing(href, detailPage),
            ]);

            // Push previous record — email is now resolved
            if (pendingRecord) {
              await pushResult({ ...pendingRecord, email: prevEmail, hasEmail: !!prevEmail });
            }

            const detail = await extractListingDetail(detailPage);

            pendingRecord = {
              name: basic.name || detail.name,
              phone: detail.phone,
              address: detail.address,
              website: detail.website,
              category: basic.category,
              rating: basic.rating,
              reviewCount: detail.reviewCount,
              scrapedAt: new Date().toISOString(),
            };

            // Skip website scraping if email already found on the Maps page.
            // Only crawl the website as a fallback when Maps has no email.
            pendingEmail = detail.email
              ? Promise.resolve(detail.email)
              : detail.website
                ? scrapeEmailFromWebsite(detail.website, browser).catch(() => null)
                : Promise.resolve(null);

            console.log(`[gmaps-full] ${i + 1}/${cardData.length} — ${pendingRecord.name}`);
            await humanDelay(800, 1500);

          } catch (err) {
            console.warn(`[gmaps-full] Listing ${i + 1} failed: ${err.message}`);
            // Flush any pending record before moving on
            if (pendingRecord) {
              try {
                const email = await pendingEmail;
                await pushResult({ ...pendingRecord, email, hasEmail: !!email });
              } catch { /* ignore flush error */ }
              pendingRecord = null;
              pendingEmail = Promise.resolve(null);
            }
          }
        }

        // Flush the last record
        if (pendingRecord) {
          const lastEmail = await pendingEmail;
          await pushResult({ ...pendingRecord, email: lastEmail, hasEmail: !!lastEmail });
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
