'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { launchLocal, launchApify } = require('../../shared/browser');
const { scrapeContactFromWebsite } = require('../../shared/websiteScraper');
const { humanDelay } = require('../../shared/delays');
const { runConcurrent } = require('../../shared/utils');
const { searchMapsHttp } = require('./httpSearch');

const WEBSITE_CONCURRENCY = 3;

// Domains that indicate a social profile (no real website)
const SOCIAL_DOMAINS = ['instagram.com', 'facebook.com', 'fb.com'];

// Domains that are directories/platforms (not an owned website)
const SKIP_DOMAINS = ['twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'google.com', 'yelp.com', 'tripadvisor.com'];

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function hasRealWebsite(url) {
  if (!url) return false;
  const host = getDomain(url);
  if (SOCIAL_DOMAINS.includes(host)) return false;
  if (SKIP_DOMAINS.includes(host)) return false;
  return true;
}

/**
 * GMaps HTTP no-website scraper.
 *
 * Uses Google's internal tbm=map API (HTTP, no browser) for Phase 1.
 * Filters out any listing that has a real website — keeps only:
 *   - listings with no URL at all
 *   - listings whose URL is a social profile (Instagram, Facebook)
 *   - listings whose URL is a directory (Yelp, TripAdvisor, etc.)
 *
 * Phase 2 — if includeSocial=true and listing has a social URL: scrape
 * email + phone from that social profile via browser.
 *
 * @param {object}   input
 * @param {string}   input.query
 * @param {string[]} [input.geoTiles]
 * @param {number}   [input.maxResults=20]
 * @param {boolean}  [input.includeSocial=true]
 * @param {Function} pushResult
 * @param {string}   [proxyUrl]
 */
async function run({ query, geoTiles, maxResults = 20, includeSocial = true, pushResult, proxyUrl }) {
  const queries = geoTiles && geoTiles.length > 0 ? geoTiles : [query];
  const seen = new Set();

  let browser = null;
  async function getBrowser() {
    if (!browser) {
      browser = proxyUrl ? await launchApify(proxyUrl) : await launchLocal();
    }
    return browser;
  }

  try {
    for (const q of queries) {
      console.log(`[gmaps-http-no-website] Searching: ${q}`);

      // ── Phase 1: HTTP search ───────────────────────────────────────────────
      const listings = await searchMapsHttp(q, maxResults);

      if (listings.length === 0) {
        console.warn(`[gmaps-http-no-website] No listings for "${q}"`);
        await humanDelay(1500, 3000);
        continue;
      }

      // Filter: keep only listings without a real website
      const noWebsite = listings.filter((l) => !hasRealWebsite(l.website));
      console.log(`[gmaps-http-no-website] ${noWebsite.length}/${listings.length} have no real website`);

      // Deduplicate across geo tiles
      const records = [];
      for (const listing of noWebsite) {
        const key = `${listing.name}|${listing.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push({
          name: listing.name,
          phone: null,
          address: listing.address,
          website: listing.website,   // null or social URL
          email: null,
          category: listing.category,
          rating: listing.rating,
          scrapedAt: new Date().toISOString(),
        });
      }

      console.log(`[gmaps-http-no-website] ${records.length} unique no-website records`);

      // ── Phase 2: scrape email/phone from social profile (if URL exists) ───
      const needsSocial = records.filter((r) => r.website && includeSocial);
      if (needsSocial.length > 0) {
        console.log(`[gmaps-http-no-website] Phase 2: ${needsSocial.length} social profile scrapes`);
        await runConcurrent(
          needsSocial.map((record) => async () => {
            const t = Date.now();
            const b = await getBrowser();
            const { phone, email } = await scrapeContactFromWebsite(record.website, b, { includeSocial: true })
              .catch(() => ({ phone: null, email: null }));
            record.phone = phone;
            record.email = email;
            const elapsed = ((Date.now() - t) / 1000).toFixed(1);
            const found = [phone && 'phone', email && 'email'].filter(Boolean).join('+') || 'nothing';
            console.log(`[gmaps-http-no-website] social — ${record.name}: ${found} (${elapsed}s)`);
          }),
          WEBSITE_CONCURRENCY
        );
      }

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
      console.log('[gmaps-http-no-website] Proxy configured:', proxyUrl.replace(/:[^@]+@/, ':***@'));
    } catch (err) {
      console.warn('[gmaps-http-no-website] Proxy setup skipped:', err.message);
    }
    await run({
      ...input,
      pushResult: (record) => Actor.pushData(record),
      proxyUrl,
    });
  });
}
