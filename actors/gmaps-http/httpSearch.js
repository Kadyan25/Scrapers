'use strict';

const { isValidUrl } = require('../../shared/utils');

const TIMEOUT_MS = 12000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });
    if (!res.ok) { console.warn(`[gmaps-http] HTTP ${res.status} for ${url}`); return null; }
    return await res.text();
  } catch (err) {
    console.warn(`[gmaps-http] fetch failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the internal Maps search API URL from the initial Maps search page HTML.
 * Google embeds the tbm=map endpoint (with pb= protobuf parameter) in a link href.
 */
function extractSearchApiUrl(html) {
  const m = html.match(/href="(\/search\?tbm=map[^"]+)"/);
  if (!m) return null;
  return 'https://www.google.com' +
    m[1].replace(/&amp;/g, '&')
        .replace(/gl=[a-z]{2}/, 'gl=us')
        .replace(/hl=[a-z]{2}/, 'hl=en');
}

/**
 * Parse listing objects from Google Maps tbm=map API response.
 * Returns )]}' prefixed JSON; listings are at root[64][i][1] with confirmed positions:
 *   [2]  = ["street", "city, state zip"]
 *   [4]  = [null×7, rating]
 *   [7]  = [url, domain, ...]
 *   [9]  = [null, null, lat, lng]
 *   [10] = "0xHEX:0xHEX"  (place id hex)
 *   [11] = "Business Name"
 *   [13] = ["Category", ...]
 *
 * Note: phone number is NOT in this response — it requires JS rendering.
 */
function parseApiResponse(text) {
  const json = JSON.parse(text.replace(/^\)\]\}'\n/, ''));
  const raw = json[64];
  if (!Array.isArray(raw)) return [];

  return raw.map((item) => {
    const d = item?.[1];
    if (!d) return null;

    const addrParts = d[2];
    const address = Array.isArray(addrParts) ? addrParts.join(', ') : null;
    const website = d[7]?.[0] || null;
    const rating = d[4]?.[7] ?? null;
    const name = d[11] || null;
    const categories = Array.isArray(d[13]) ? d[13] : [];

    if (!name) return null;

    return {
      name,
      address,
      website: isValidUrl(website) ? website : null,
      rating: typeof rating === 'number' ? rating : null,
      category: categories[0] || null,
    };
  }).filter(Boolean);
}

/**
 * Search Google Maps via HTTP and return listing objects (no browser required).
 * Paginates using start=N parameter — Google returns 20 results per page.
 *
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{name, address, website, rating, category}>>}
 */
async function searchMapsHttp(query, limit) {
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  console.log(`[gmaps-http] HTTP search: ${searchUrl}`);

  // Step 1: get the internal API URL with pb= parameter from initial page
  const html = await fetchHtml(searchUrl);
  if (!html) return [];

  const baseApiUrl = extractSearchApiUrl(html);
  if (!baseApiUrl) {
    console.warn('[gmaps-http] No API URL found — page may be blocked. First 400 chars:');
    console.warn(html.slice(0, 400));
    return [];
  }

  // Step 2: paginate — 20 results per page, stop when we have enough or run dry
  const PAGE_SIZE = 20;
  const allListings = [];

  for (let start = 0; allListings.length < limit; start += PAGE_SIZE) {
    const apiUrl = start === 0 ? baseApiUrl : `${baseApiUrl}&start=${start}`;
    const apiResponse = await fetchHtml(apiUrl);
    if (!apiResponse) break;

    let page;
    try {
      page = parseApiResponse(apiResponse);
    } catch (err) {
      console.warn(`[gmaps-http] Parse failed at start=${start}:`, err.message);
      break;
    }

    if (page.length === 0) break; // no more results

    allListings.push(...page);
    console.log(`[gmaps-http] Page start=${start}: ${page.length} listings (${allListings.length} total)`);

    if (page.length < PAGE_SIZE) break; // last page
  }

  if (allListings[0]) console.log(`[gmaps-http] Sample: ${allListings[0].name} — ${allListings[0].address}`);

  return allListings.slice(0, limit);
}

module.exports = { searchMapsHttp };
