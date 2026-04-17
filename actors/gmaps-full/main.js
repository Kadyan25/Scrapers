'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify, newContext, blockHeavyResources } = require('../../shared/browser');
const { searchMaps, scrollResults, collectCardData, navigateToListing, extractListingDetail } = require('../../shared/gmapsNavigator');
const { scrapeEmailFromWebsite } = require('../../shared/websiteScraper');
const { humanDelay } = require('../../shared/delays');
const { runConcurrent } = require('../../shared/utils');

// Max parallel website scrapes. Business websites are all different domains
// so concurrency here doesn't trigger rate limits.
const WEBSITE_CONCURRENCY = 5;

/**
 * Run the GMaps Full scraper.
 *
 * Phase 1 — search + scroll, collect card data + place URLs.
 * Phase 2 — sequential GMaps navigation (anti-detection), collect all detail records.
 * Phase 3 — concurrent website scraping (up to WEBSITE_CONCURRENCY at once)
 *           for records that have no email from Maps. Records with email already
 *           on the Maps page skip Phase 3 entirely.
 *
 * @param {object}   input
 * @param {string}   input.query
 * @param {string[]} [input.geoTiles]
 * @param {number}   [input.maxResults=120]
 * @param {Function} pushResult
 * @param {string}   [proxyUrl]
 */
async function run({ query, geoTiles, maxResults = 120, includeSocial = false, pushResult, proxyUrl }) {
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
        listings = await scrollResults(listPage, maxResults);
      } catch (err) {
        console.warn(`[gmaps-full] scrollResults failed for "${q}": ${err.message}`);
        await listContext.close();
        continue;
      }

      console.log(`[gmaps-full] Found ${listings.length} listings, collecting up to ${maxResults}`);
      const cardData = await collectCardData(listings, maxResults);
      await listContext.close();

      // ── Phase 2: sequential GMaps navigation, build record list ───────────
      const detailContext = await newContext(browser);
      const detailPage = await detailContext.newPage();
      await blockHeavyResources(detailPage);
      const records = [];

      try {
        for (let i = 0; i < cardData.length; i++) {
          const { basic, href } = cardData[i];
          if (!href) continue;

          const dedupeKey = `${basic.name}|${basic.category}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          try {
            const t = Date.now();
            await navigateToListing(href, detailPage);
            const detail = await extractListingDetail(detailPage);
            const navMs = ((Date.now() - t) / 1000).toFixed(1);

            records.push({
              name: basic.name || detail.name,
              phone: detail.phone,
              address: detail.address,
              website: detail.website,
              email: detail.email,       // may already be set from Maps page
              category: basic.category,
              rating: basic.rating,
              reviewCount: detail.reviewCount,
              scrapedAt: new Date().toISOString(),
            });

            const emailSource = detail.email ? ' [email:maps]' : detail.website ? ' [email:pending]' : '';
            console.log(`[gmaps-full] ${i + 1}/${cardData.length} — ${basic.name || detail.name} (nav ${navMs}s${emailSource})`);
            await humanDelay(800, 1500);
          } catch (err) {
            console.warn(`[gmaps-full] Listing ${i + 1} failed: ${err.message}`);
          }
        }
      } finally {
        await detailContext.close();
      }

      // ── Phase 3: concurrent website scraping for missing emails ───────────
      const needsScrape = records.filter((r) => !r.email && r.website);
      const skipCount   = records.length - needsScrape.length;

      console.log(
        `[gmaps-full] Phase 3: ${needsScrape.length} website scrapes` +
        (skipCount > 0 ? `, ${skipCount} already have email` : '')
      );

      await runConcurrent(
        needsScrape.map((record) => async () => {
          const t = Date.now();
          record.email = await scrapeEmailFromWebsite(record.website, browser, { includeSocial }).catch(() => null);
          const elapsed = ((Date.now() - t) / 1000).toFixed(1);
          console.log(`[gmaps-full] website scrape — ${record.name}: ${record.email || 'no email'} (${elapsed}s)`);
        }),
        WEBSITE_CONCURRENCY
      );

      // Push all records once emails are filled
      for (const record of records) {
        record.hasEmail = !!record.email;
        await pushResult(record);
      }

      await humanDelay(1500, 3000);
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
    let proxyUrl;
    try {
      const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
        countryCode: 'US',
        // Falls back to datacenter if residential unavailable on this plan
      });
      proxyUrl = await proxyConfiguration.newUrl();
      console.log('[gmaps-full] Proxy configured:', proxyUrl.replace(/:[^@]+@/, ':***@'));
    } catch (err) {
      console.error('[gmaps-full] Proxy setup failed — Google Maps will likely block requests without a residential proxy:', err.message);
    }
    await run({
      ...input,
      pushResult: (record) => Actor.pushData(record),
      proxyUrl,
    });
  });
}
