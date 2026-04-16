'use strict';

const PHONE_REGEX = /(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/**
 * Extract all phone numbers from text. Returns a deduplicated array.
 */
function extractPhones(text) {
  if (!text) return [];
  const matches = text.match(PHONE_REGEX) || [];
  return [...new Set(matches.map(cleanPhone))].filter(Boolean);
}

/**
 * Normalize a phone string to (555) 555-5555 format.
 * Returns null if the string doesn't contain enough digits.
 */
function cleanPhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // Strip leading country code 1 if 11 digits
  const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Extract all email addresses from text.
 */
function extractEmails(text) {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) || [];
  return [...new Set(matches.map(cleanEmail))].filter(Boolean);
}

/**
 * Normalize an email: lowercase and trim.
 */
function cleanEmail(email) {
  if (!email) return null;
  return email.toLowerCase().trim();
}

/**
 * Return true if str looks like a usable URL (http/https).
 */
function isValidUrl(str) {
  if (!str) return false;
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Run an array of async task functions with a max concurrency limit.
 * Always keeps `limit` tasks in flight until all are done.
 *
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} limit
 */
async function runConcurrent(tasks, limit) {
  let idx = 0;
  async function runNext() {
    if (idx >= tasks.length) return;
    const i = idx++;
    await tasks[i]();
    await runNext();
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, runNext);
  await Promise.all(workers);
}

module.exports = { extractPhones, cleanPhone, extractEmails, cleanEmail, isValidUrl, runConcurrent };
