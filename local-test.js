'use strict';

require('dotenv').config();

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

// ─── Result collector ─────────────────────────────────────────────────────────

const results = [];
async function pushResult(record) {
  results.push(record);
}

// ─── Run selected scraper ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Local Test: ${TEST_SCRAPER} ===\n`);

  const input = TEST_INPUTS[TEST_SCRAPER];
  if (!input) {
    console.error(`Unknown TEST_SCRAPER: "${TEST_SCRAPER}". Options: gmaps-full, gmaps-no-website, phone-enricher`);
    process.exit(1);
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

  // ─── Print results table ────────────────────────────────────────────────────
  console.log(`\n=== Results (${results.length} records in ${elapsed}s) ===\n`);

  if (results.length === 0) {
    console.log('No results returned.');
    return;
  }

  // Use first record's keys as column headers
  const keys = Object.keys(results[0]);
  const colWidths = keys.map((k) =>
    Math.min(30, Math.max(k.length, ...results.map((r) => String(r[k] ?? '').length)))
  );

  const header = keys.map((k, i) => k.padEnd(colWidths[i])).join('  ');
  const divider = colWidths.map((w) => '-'.repeat(w)).join('  ');

  console.log(header);
  console.log(divider);

  for (const row of results) {
    const line = keys
      .map((k, i) => String(row[k] ?? '').slice(0, colWidths[i]).padEnd(colWidths[i]))
      .join('  ');
    console.log(line);
  }

  console.log(`\nDone.\n`);
}

main();
