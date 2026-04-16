'use strict';

const { newContext } = require('./browser');
const { extractPhones, extractEmails, cleanPhone, cleanEmail } = require('./utils');
const { pageLoadDelay, humanDelay } = require('./delays');

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us'];

// Domains we skip entirely — no useful contact info scrapeable
const SKIP_DOMAINS = ['twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'google.com', 'yelp.com', 'tripadvisor.com'];

// Domains that get social-specific scraping instead of contact-page crawl
const INSTAGRAM_DOMAINS = ['instagram.com', 'www.instagram.com'];
const FACEBOOK_DOMAINS  = ['facebook.com', 'www.facebook.com', 'fb.com'];

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function shouldSkip(url) {
  const d = getDomain(url);
  return SKIP_DOMAINS.some((s) => d === s || d.endsWith('.' + s));
}

// ─── Social scrapers ──────────────────────────────────────────────────────────

/**
 * Scrape phone + email from an Instagram public business profile.
 * Looks for tel:/mailto: links and visible text in the bio area.
 */
async function scrapeInstagram(url, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pageLoadDelay();

    const tel = await page.$eval('a[href^="tel:"]', (a) => a.href.replace('tel:', '').trim()).catch(() => null);
    const mailto = await page.$eval('a[href^="mailto:"]', (a) => a.href.replace('mailto:', '').split('?')[0].trim()).catch(() => null);

    // Bio text as fallback
    const bioText = await page.evaluate(() => {
      const bio = document.querySelector('header section, [data-testid="user-bio"]');
      return bio ? bio.innerText : document.body.innerText.slice(0, 2000);
    }).catch(() => '');

    const phone = tel ? cleanPhone(tel) : extractPhones(bioText)[0] || null;
    const email = mailto ? cleanEmail(mailto) : extractEmails(bioText)[0] || null;
    return { phone, email };
  } catch {
    return { phone: null, email: null };
  } finally {
    await context.close();
  }
}

/**
 * Scrape phone + email from a Facebook public page's About section.
 */
async function scrapeFacebook(url, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    const base = url.replace(/\/$/, '');
    const aboutUrl = base.includes('/about') ? base : `${base}/about`;
    await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pageLoadDelay();

    const tel = await page.$eval('a[href^="tel:"]', (a) => a.href.replace('tel:', '').trim()).catch(() => null);
    const mailto = await page.$eval('a[href^="mailto:"]', (a) => a.href.replace('mailto:', '').split('?')[0].trim()).catch(() => null);

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 5000)).catch(() => '');

    const phone = tel ? cleanPhone(tel) : extractPhones(bodyText)[0] || null;
    const email = mailto ? cleanEmail(mailto) : extractEmails(bodyText)[0] || null;
    return { phone, email };
  } catch {
    return { phone: null, email: null };
  } finally {
    await context.close();
  }
}

// ─── Main scrapers ────────────────────────────────────────────────────────────

/**
 * Scrape a phone number from a website.
 * - Skips Twitter/X and other non-scrapeable domains (returns null)
 * - Uses social-specific logic for Instagram and Facebook URLs
 * - Otherwise crawls /, /contact, /contact-us, /about, /about-us
 * @returns {string|null}
 */
async function scrapePhoneFromWebsite(url, browser) {
  if (!url) return null;
  if (shouldSkip(url)) return null;

  const domain = getDomain(url);

  if (INSTAGRAM_DOMAINS.includes(domain)) {
    const { phone } = await scrapeInstagram(url, browser);
    return phone;
  }
  if (FACEBOOK_DOMAINS.includes(domain)) {
    const { phone } = await scrapeFacebook(url, browser);
    return phone;
  }

  // Standard website crawl
  // No pageLoadDelay() here — business websites won't rate-limit us.
  // The page.goto() call itself + domcontentloaded provides enough settling time.
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    const base = url.replace(/\/$/, '');
    for (const path of CONTACT_PATHS) {
      try {
        await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 8000 });

        const telLinks = await page.$$eval('a[href^="tel:"]', (links) =>
          links.map((a) => a.href.replace('tel:', '').trim())
        );
        if (telLinks.length > 0) {
          const cleaned = cleanPhone(telLinks[0]);
          if (cleaned) return cleaned;
        }

        const phones = extractPhones(await page.evaluate(() => document.body.innerText));
        if (phones.length > 0) return phones[0];
      } catch { /* page failed to load — try next path */ }
    }
  } finally {
    await context.close();
  }
  return null;
}

/**
 * Scrape an email address from a website.
 * - Skips Twitter/X and other non-scrapeable domains (returns null)
 * - Uses social-specific logic for Instagram and Facebook URLs
 * - Otherwise crawls /, /contact, /contact-us, /about, /about-us
 * @returns {string|null}
 */
async function scrapeEmailFromWebsite(url, browser) {
  if (!url) return null;
  if (shouldSkip(url)) return null;

  const domain = getDomain(url);

  if (INSTAGRAM_DOMAINS.includes(domain)) {
    const { email } = await scrapeInstagram(url, browser);
    return email;
  }
  if (FACEBOOK_DOMAINS.includes(domain)) {
    const { email } = await scrapeFacebook(url, browser);
    return email;
  }

  // Standard website crawl
  const context = await newContext(browser);
  const page = await context.newPage();
  try {
    const base = url.replace(/\/$/, '');
    for (const path of CONTACT_PATHS) {
      try {
        await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 8000 });

        const mailtoLinks = await page.$$eval('a[href^="mailto:"]', (links) =>
          links.map((a) => a.href.replace('mailto:', '').split('?')[0].trim())
        );
        if (mailtoLinks.length > 0) {
          const cleaned = cleanEmail(mailtoLinks[0]);
          if (cleaned) return cleaned;
        }

        const emails = extractEmails(await page.evaluate(() => document.body.innerText));
        if (emails.length > 0) return emails[0];
      } catch { /* page failed to load — try next path */ }
    }
  } finally {
    await context.close();
  }
  return null;
}

module.exports = { scrapePhoneFromWebsite, scrapeEmailFromWebsite };
