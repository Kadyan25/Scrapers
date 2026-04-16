'use strict';

require('dotenv').config();

const { ResultStore } = require('./shared/store');

const TEST_SCRAPER = process.env.TEST_SCRAPER || 'gmaps-full';

// ─── Test inputs per scraper ─────────────────────────────────────────────────

const TEST_INPUTS = {
  'gmaps-full': {
    query: 'auto body shop Brooklyn NY',
    maxResults: 5,
  },

  'gmaps-no-website': {
    query: 'plumber Queens NY',
    maxResults: 10,
  },

  'phone-enricher': {
    records: [
      { businessName: 'Joe\'s Auto Repair Brooklyn', website: 'https://joesauto.com' },
      { businessName: 'Manhattan Dental Studio', email: 'info@manhattandental.com' },
      { businessName: 'Brooklyn Radiator Works' },
    ],
  },
};

// ─── Run selected scraper ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Local Test: ${TEST_SCRAPER} ===\n`);

  const input = TEST_INPUTS[TEST_SCRAPER];
  if (!input) {
    console.error(`Unknown TEST_SCRAPER: "${TEST_SCRAPER}". Options: gmaps-full, gmaps-no-website, phone-enricher`);
    process.exit(1);
  }

  // Store loads existing records from results/<scraper>.json and builds dedup index
  const store = new ResultStore(TEST_SCRAPER);
  const savedBefore = store.count;

  async function pushResult(record) {
    store.push(record); // silently drops duplicates
  }

  const { run } = require(`./actors/${TEST_SCRAPER}/main`);
  const startMs = Date.now();

  try {
    await run({ ...input, pushResult });
  } catch (err) {
    console.error(`\n[local-test] Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const newRecords = store.count - savedBefore;

  // ─── Print results table (new records only) ────────────────────────────────
  console.log(`\n=== Session summary (${elapsed}s) ===`);
  console.log(`  New records saved : ${newRecords}`);
  console.log(`  Duplicates skipped: ${store.skipped}`);
  console.log(`  Total in store    : ${store.count}`);
  console.log(`  Saved to          : results/${TEST_SCRAPER}.json\n`);

  const allRecords = store.getAll();
  const sessionRecords = allRecords.slice(savedBefore); // only rows added this run

  if (sessionRecords.length === 0) {
    console.log('No new records this run.\n');
    return;
  }

  // Use first record's keys as column headers
  const keys = Object.keys(sessionRecords[0]);
  const colWidths = keys.map((k) =>
    Math.min(30, Math.max(k.length, ...sessionRecords.map((r) => String(r[k] ?? '').length)))
  );

  const header = keys.map((k, i) => k.padEnd(colWidths[i])).join('  ');
  const divider = colWidths.map((w) => '-'.repeat(w)).join('  ');

  console.log(header);
  console.log(divider);

  for (const row of sessionRecords) {
    const line = keys
      .map((k, i) => String(row[k] ?? '').slice(0, colWidths[i]).padEnd(colWidths[i]))
      .join('  ');
    console.log(line);
  }

  console.log(`\nDone.\n`);
}

main();
