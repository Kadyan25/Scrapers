'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify } = require('../../shared/browser');
const { scrapeContactFromWebsite } = require('../../shared/websiteScraper');
const { humanDelay } = require('../../shared/delays');
const { runConcurrent } = require('../../shared/utils');
const { searchMapsHttp } = require('./httpSearch');

const WEBSITE_CONCURRENCY = 5;

/**
 * GMaps HTTP scraper — experimental alternative to gmaps-full.
 *
 * Uses Google's internal tbm=map API (HTTP, no browser) for Phase 1.
 * No browser or proxy needed for Maps search — no cost for this phase.
 * Phone number is NOT extractable via HTTP (requires JS rendering) — this is the trade-off.
 *
 * Phase 1 — HTTP search: call Google's internal Maps API, parse listings from JSON.
 * Phase 2 — HTTP website: scrape business website for email.
 * Browser launched only if includeSocial=true and a listing has an Instagram/Facebook site.
 *
 * @param {object}   input
 * @param {string}   input.query
 * @param {string[]} [input.geoTiles]
 * @param {number}   [input.maxResults=20]
 * @param {boolean}  [input.includeSocial=false]
 * @param {Function} pushResult
 * @param {string}   [proxyUrl]  — only used for website scraping, not Maps search
 */
async function run({ query, geoTiles, maxResults = 20, includeSocial = false, pushResult, proxyUrl }) {
  const queries = geoTiles && geoTiles.length > 0 ? geoTiles : [query];
  const seen = new Set();

  // Browser lazy-init: only launched if a listing needs Instagram/Facebook scraping
  let browser = null;
  async function getBrowser() {
    if (!browser) {
      browser = proxyUrl ? await launchApify(proxyUrl) : await launchLocal();
    }
    return browser;
  }

  try {
    for (const q of queries) {
      console.log(`[gmaps-http] Searching: ${q}`);

      // ── Phase 1: HTTP search (no browser, no proxy) ────────────────────────
      const listings = await searchMapsHttp(q, maxResults);

      if (listings.length === 0) {
        console.warn(`[gmaps-http] No listings found for "${q}"`);
        await humanDelay(1500, 3000);
        continue;
      }

      // Deduplicate across geo tiles
      const records = [];
      for (const listing of listings) {
        const key = `${listing.name}|${listing.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push({
          name: listing.name,
          phone: null,           // not available via HTTP
          address: listing.address,
          website: listing.website,
          email: null,
          category: listing.category,
          rating: listing.rating,
          scrapedAt: new Date().toISOString(),
        });
      }

      console.log(`[gmaps-http] ${records.length} unique records (${listings.length - records.length} dupes)`);

      // ── Phase 2: HTTP website scraping for email ───────────────────────────
      const needsScrape = records.filter((r) => r.website);
      console.log(`[gmaps-http] Phase 2: ${needsScrape.length} website scrapes`);

      await runConcurrent(
        needsScrape.map((record) => async () => {
          const t = Date.now();
          const b = await getBrowser();
          const { phone, email } = await scrapeContactFromWebsite(record.website, b, { includeSocial }).catch(() => ({ phone: null, email: null }));
          record.phone = phone;
          record.email = email;
          const elapsed = ((Date.now() - t) / 1000).toFixed(1);
          const found = [phone && 'phone', email && 'email'].filter(Boolean).join('+') || 'nothing';
          console.log(`[gmaps-http] website — ${record.name}: ${found} (${elapsed}s)`);
        }),
        WEBSITE_CONCURRENCY
      );

      for (const record of records) {
        record.hasEmail = !!record.email;
        await pushResult(record);
      }

      await humanDelay(1000, 2000);
    }
  } finally {
    if (browser) await browser.close();
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
      });
      proxyUrl = await proxyConfiguration.newUrl();
      console.log('[gmaps-http] Proxy configured (website scraping only):', proxyUrl.replace(/:[^@]+@/, ':***@'));
    } catch (err) {
      console.warn('[gmaps-http] Proxy setup skipped:', err.message);
    }
    await run({
      ...input,
      pushResult: (record) => Actor.pushData(record),
      proxyUrl,
    });
  });
}
