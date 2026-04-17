'use strict';
// Quick script to explore the Google Maps API response structure

async function run() {
  const r1 = await fetch('https://www.google.com/maps/search/auto+body+shop+Brooklyn+NY', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  const html = await r1.text();
  const m = html.match(/href="(\/search\?tbm=map[^"]+)"/);
  if (!m) { console.log('no API url found'); return; }
  const apiUrl = 'https://www.google.com' + m[1].replace(/&amp;/g, '&').replace(/gl=[a-z]{2}/, 'gl=us').replace(/hl=[a-z]{2}/, 'hl=en');
  console.log('API URL:', apiUrl.slice(0, 120));

  const r2 = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  const raw = await r2.text();
  const json = JSON.parse(raw.replace(/^\)\]\}'\n/, ''));

  // Print the top-level structure
  console.log('\n--- Top level type:', Array.isArray(json) ? 'array[' + json.length + ']' : typeof json);

  // Walk and print paths that contain business-like strings
  function walk(obj, path, depth) {
    if (depth > 8) return;
    if (typeof obj === 'string') {
      // Show strings that look like business data
      if (obj.length > 4 && obj.length < 200) {
        console.log(`${path}: ${JSON.stringify(obj)}`);
      }
      return;
    }
    if (typeof obj === 'number' && String(obj).includes('.') && obj > 10) {
      console.log(`${path}: ${obj}  ← (coordinates?)`);
      return;
    }
    if (Array.isArray(obj)) {
      // Only traverse arrays with reasonable length to avoid infinite output
      const limit = Math.min(obj.length, depth < 3 ? 10 : 3);
      for (let i = 0; i < limit; i++) {
        walk(obj[i], `${path}[${i}]`, depth + 1);
      }
    }
  }

  // Print shape of each top-level element
  console.log('\n--- Root elements:');
  for (let i = 0; i < json.length; i++) {
    const el = json[i];
    if (el === null) continue;
    const type = Array.isArray(el) ? `array[${el.length}]` : typeof el;
    console.log(`root[${i}]: ${type}`, typeof el === 'string' ? JSON.stringify(el).slice(0, 80) : '');
  }

  // Look for the element most likely to contain listings (large array of arrays)
  const candidates = json.filter((el, i) => Array.isArray(el) && el.length > 5).map((el, i) => i);
  console.log('\n--- Array candidates at root level:', candidates);

  // Print exact field positions for first 2 listings
  for (let i = 0; i < 2; i++) {
    const l = json[64]?.[i];
    if (!l) continue;
    const d = l[1]; // data array
    console.log(`\n=== Listing ${i} ===`);
    console.log('d[0] (session_id):', d?.[0]);
    console.log('d[2] (address):', JSON.stringify(d?.[2]));
    console.log('d[4] (rating array):', JSON.stringify(d?.[4]));
    console.log('d[7] (website):', JSON.stringify(d?.[7]?.slice?.(0,2)));
    console.log('d[9] (coords):', JSON.stringify(d?.[9]));
    console.log('d[10] (place_hex):', d?.[10]);
    console.log('d[11] (name):', d?.[11]);
    console.log('d[13] (categories):', JSON.stringify(d?.[13]));
    console.log('d[14] (neighborhood):', d?.[14]);
    console.log('d[18] (full_address):', d?.[18]);
  }

  // Try fetching the detail page for one listing via CID URL
  const listing = json[64]?.[0];
  const placeHex = listing?.[1]?.[10]; // e.g. "0x89c25be2a1c81257:0xf0922b988d8baa69"
  const name = listing?.[1]?.[11];
  console.log('\n--- Listing:', name, '| place_id_hex:', placeHex);

  if (placeHex) {
    const cidHex = placeHex.split(':')[1]; // "0xf0922b988d8baa69"
    const cid = BigInt(cidHex).toString(10);
    const detailUrl = `https://www.google.com/maps?cid=${cid}`;
    console.log('[gmaps-http] Fetching detail via CID URL:', detailUrl);

    const r3 = await fetch(detailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const detailHtml = await r3.text();
    console.log('Detail page status:', r3.status, '| size:', detailHtml.length, 'bytes');
    console.log('Contains JSON-LD?', detailHtml.includes('application/ld+json'));
    console.log('Contains telephone?', detailHtml.includes('telephone'));
    console.log('Contains phone?', /\(\d{3}\)/.test(detailHtml));

    // Extract JSON-LD blocks
    const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let ldm;
    while ((ldm = ldRe.exec(detailHtml)) !== null) {
      try {
        const obj = JSON.parse(ldm[1].trim());
        console.log('\nJSON-LD found:', JSON.stringify(obj, null, 2).slice(0, 600));
      } catch {}
    }

    // Also look for phone patterns in the raw HTML
    const phoneMatch = detailHtml.match(/\(\d{3}\)\s*\d{3}-\d{4}/);
    console.log('Phone in HTML:', phoneMatch?.[0] || 'not found');

    // Look for tel: links
    const telMatch = detailHtml.match(/tel:[+\d\s()-]+/);
    console.log('tel: link:', telMatch?.[0] || 'not found');
  }
}

run().catch(console.error);
