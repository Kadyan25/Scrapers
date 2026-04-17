'use strict';

const { newContext } = require('./browser');
const { extractPhones, extractEmails, cleanPhone, cleanEmail } = require('./utils');
const { pageLoadDelay } = require('./delays');

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us'];

const SKIP_DOMAINS = ['twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'google.com', 'yelp.com', 'tripadvisor.com'];
const INSTAGRAM_DOMAINS = ['instagram.com', 'www.instagram.com'];
const FACEBOOK_DOMAINS  = ['facebook.com', 'www.facebook.com', 'fb.com'];

const FETCH_TIMEOUT_MS = 6000;
const FETCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function shouldSkip(url) {
  const d = getDomain(url);
  return SKIP_DOMAINS.some((s) => d === s || d.endsWith('.' + s));
}

/**
 * Plain HTTP fetch — no browser, no JS rendering, no memory overhead.
 * Returns raw HTML string or null on timeout/error.
 */
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': FETCH_UA, 'Accept': 'text/html' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, c) => String.fromCharCode(parseInt(c, 16)));
}

function phoneFromHtml(html) {
  const telMatch = html.match(/href=["']tel:([^"']+)["']/i);
  if (telMatch) {
    const cleaned = cleanPhone(telMatch[1].trim());
    if (cleaned) return cleaned;
  }
  return extractPhones(html)[0] || null;
}

function emailFromHtml(html) {
  const mailMatch = html.match(/href=["']mailto:([^"'?]+)/i);
  if (mailMatch) {
    const cleaned = cleanEmail(mailMatch[1].trim());
    if (cleaned) return cleaned;
  }
  return extractEmails(html)[0] || null;
}

// ─── Social scrapers — still need Playwright, JS-rendered pages ───────────────

async function scrapeInstagram(url, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pageLoadDelay();
    const tel    = await page.$eval('a[href^="tel:"]',    (a) => a.href.replace('tel:', '').trim()).catch(() => null);
    const mailto = await page.$eval('a[href^="mailto:"]', (a) => a.href.replace('mailto:', '').split('?')[0].trim()).catch(() => null);
    const bioText = await page.evaluate(() => {
      const bio = document.querySelector('header section, [data-testid="user-bio"]');
      return bio ? bio.innerText : document.body.innerText.slice(0, 2000);
    }).catch(() => '');
    return {
      phone: tel    ? cleanPhone(tel)    : extractPhones(bioText)[0] || null,
      email: mailto ? cleanEmail(mailto) : extractEmails(bioText)[0] || null,
    };
  } catch {
    return { phone: null, email: null };
  } finally {
    await context.close();
  }
}

async function scrapeFacebook(url, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    const base = url.replace(/\/$/, '');
    const aboutUrl = base.includes('/about') ? base : `${base}/about`;
    await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pageLoadDelay();
    const tel    = await page.$eval('a[href^="tel:"]',    (a) => a.href.replace('tel:', '').trim()).catch(() => null);
    const mailto = await page.$eval('a[href^="mailto:"]', (a) => a.href.replace('mailto:', '').split('?')[0].trim()).catch(() => null);
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 5000)).catch(() => '');
    return {
      phone: tel    ? cleanPhone(tel)    : extractPhones(bodyText)[0] || null,
      email: mailto ? cleanEmail(mailto) : extractEmails(bodyText)[0] || null,
    };
  } catch {
    return { phone: null, email: null };
  } finally {
    await context.close();
  }
}

// ─── Main scrapers ────────────────────────────────────────────────────────────

/**
 * Find a phone number from a business website using plain HTTP fetch.
 * browser is only used if the URL is an Instagram or Facebook page.
 * @returns {string|null}
 */
async function scrapePhoneFromWebsite(url, browser) {
  if (!url) return null;
  if (shouldSkip(url)) return null;
  const domain = getDomain(url);
  if (INSTAGRAM_DOMAINS.includes(domain)) return (await scrapeInstagram(url, browser)).phone;
  if (FACEBOOK_DOMAINS.includes(domain))  return (await scrapeFacebook(url, browser)).phone;

  const base = url.replace(/\/$/, '');
  for (const path of CONTACT_PATHS) {
    const raw = await fetchHtml(base + path);
    if (!raw) continue;
    const phone = phoneFromHtml(decodeEntities(raw));
    if (phone) return phone;
  }
  return null;
}

/**
 * Find an email address from a business website using plain HTTP fetch.
 * browser is only used if the URL is an Instagram or Facebook page.
 * @returns {string|null}
 */
async function scrapeEmailFromWebsite(url, browser) {
  if (!url) return null;
  if (shouldSkip(url)) return null;
  const domain = getDomain(url);
  if (INSTAGRAM_DOMAINS.includes(domain)) return (await scrapeInstagram(url, browser)).email;
  if (FACEBOOK_DOMAINS.includes(domain))  return (await scrapeFacebook(url, browser)).email;

  const base = url.replace(/\/$/, '');
  for (const path of CONTACT_PATHS) {
    const raw = await fetchHtml(base + path);
    if (!raw) continue;
    const email = emailFromHtml(decodeEntities(raw));
    if (email) return email;
  }
  return null;
}

module.exports = { scrapePhoneFromWebsite, scrapeEmailFromWebsite };
