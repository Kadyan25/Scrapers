'use strict';

const { newContext } = require('./browser');
const { extractPhones, extractEmails } = require('./utils');
const { pageLoadDelay, humanDelay } = require('./delays');

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us'];

/**
 * Open a website and hunt for a phone number across common contact pages.
 * Checks tel: links first, then plain text regex.
 * @returns {string|null} cleaned phone or null
 */
async function scrapePhoneFromWebsite(url, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();

  try {
    const base = url.replace(/\/$/, '');

    for (const path of CONTACT_PATHS) {
      const target = base + path;
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await pageLoadDelay();

        // tel: links are the most reliable signal
        const telLinks = await page.$$eval('a[href^="tel:"]', (links) =>
          links.map((a) => a.href.replace('tel:', '').trim())
        );
        if (telLinks.length > 0) {
          const { cleanPhone } = require('./utils');
          const cleaned = cleanPhone(telLinks[0]);
          if (cleaned) {
            return cleaned;
          }
        }

        // Fall back to page text regex
        const bodyText = await page.evaluate(() => document.body.innerText);
        const phones = extractPhones(bodyText);
        if (phones.length > 0) return phones[0];

        await humanDelay(400, 900);
      } catch {
        // Page failed to load — move to next path
      }
    }
  } finally {
    await context.close();
  }

  return null;
}

/**
 * Open a website and hunt for an email address across common contact pages.
 * Checks mailto: links first, then plain text regex.
 * @returns {string|null} cleaned email or null
 */
async function scrapeEmailFromWebsite(url, browser) {
  const context = await newContext(browser);
  const page = await context.newPage();

  try {
    const base = url.replace(/\/$/, '');

    for (const path of CONTACT_PATHS) {
      const target = base + path;
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await pageLoadDelay();

        // mailto: links first
        const mailtoLinks = await page.$$eval('a[href^="mailto:"]', (links) =>
          links.map((a) => a.href.replace('mailto:', '').split('?')[0].trim())
        );
        if (mailtoLinks.length > 0) {
          const { cleanEmail } = require('./utils');
          const cleaned = cleanEmail(mailtoLinks[0]);
          if (cleaned) return cleaned;
        }

        // Fall back to page text regex
        const bodyText = await page.evaluate(() => document.body.innerText);
        const emails = extractEmails(bodyText);
        if (emails.length > 0) return emails[0];

        await humanDelay(400, 900);
      } catch {
        // Page failed to load — move to next path
      }
    }
  } finally {
    await context.close();
  }

  return null;
}

module.exports = { scrapePhoneFromWebsite, scrapeEmailFromWebsite };
