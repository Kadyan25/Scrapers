'use strict';

const fs = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, '..', 'results');

/**
 * Dedup key strategies per scraper.
 * Priority: phone (most unique) → name+address / businessName+website (fallback).
 */
const DEDUP_KEY_FN = {
  'gmaps-full': (r) => {
    if (r.phone) return `phone:${r.phone}`;
    const name = (r.name || '').toLowerCase().trim();
    const addr = (r.address || '').toLowerCase().trim();
    return `name-addr:${name}|${addr}`;
  },
  'gmaps-no-website': (r) => {
    if (r.phone) return `phone:${r.phone}`;
    const name = (r.name || '').toLowerCase().trim();
    const addr = (r.address || '').toLowerCase().trim();
    return `name-addr:${name}|${addr}`;
  },
  'gmaps-http': (r) => {
    if (r.phone) return `phone:${r.phone}`;
    const name = (r.name || '').toLowerCase().trim();
    const addr = (r.address || '').toLowerCase().trim();
    return `name-addr:${name}|${addr}`;
  },
  'gmaps-http-no-website': (r) => {
    if (r.phone) return `phone:${r.phone}`;
    const name = (r.name || '').toLowerCase().trim();
    const addr = (r.address || '').toLowerCase().trim();
    return `name-addr:${name}|${addr}`;
  },
  'phone-enricher': (r) => {
    if (r.phone) return `phone:${r.phone}`;
    const biz = (r.businessName || '').toLowerCase().trim();
    const site = (r.website || '').toLowerCase().trim();
    return `biz-site:${biz}|${site}`;
  },
};

class ResultStore {
  /**
   * @param {string} scraperName — 'gmaps-full' | 'gmaps-no-website' | 'phone-enricher'
   */
  constructor(scraperName) {
    this.scraperName = scraperName;
    this.filePath = path.join(RESULTS_DIR, `${scraperName}.json`);
    this._keyFn = DEDUP_KEY_FN[scraperName];
    if (!this._keyFn) throw new Error(`No dedup strategy for scraper: ${scraperName}`);

    this._records = [];
    this._keys = new Set();
    this._skipped = 0;

    this._load();
  }

  /** Records stored so far (including pre-existing from disk). */
  get count() { return this._records.length; }

  /** Number of duplicates rejected this session. */
  get skipped() { return this._skipped; }

  /**
   * Check if a record is a duplicate of something already stored.
   */
  isDuplicate(record) {
    return this._keys.has(this._keyFn(record));
  }

  /**
   * Save a record. Silently drops duplicates.
   * Returns true if saved, false if skipped.
   */
  push(record) {
    const key = this._keyFn(record);
    if (this._keys.has(key)) {
      this._skipped++;
      console.log(`[store] Duplicate skipped: ${key}`);
      return false;
    }
    this._keys.add(key);
    this._records.push(record);
    this._flush();
    return true;
  }

  /** All stored records. */
  getAll() {
    return this._records;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  _load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const r of parsed) {
        const key = this._keyFn(r);
        this._keys.add(key);
        this._records.push(r);
      }
      console.log(`[store] Loaded ${this._records.length} existing records from ${this.filePath}`);
    } catch (err) {
      console.warn(`[store] Could not load ${this.filePath}: ${err.message}`);
    }
  }

  _flush() {
    if (!fs.existsSync(RESULTS_DIR)) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this._records, null, 2), 'utf8');
  }
}

module.exports = { ResultStore };
