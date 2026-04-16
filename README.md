# Scrapers

Three Playwright-based web scrapers for local business lead generation, deployable as Apify actors.

---

## Scrapers

| Scraper | What it does |
|---|---|
| **GMaps Full** | Search Google Maps → extract name, phone, address, email, website, category, rating |
| **GMaps No-Website** | Same search, but **only returns listings with no website** — high-intent leads |
| **Phone Enricher** | Input: business name + website + email (any combo) → Output: phone via cascade lookup |

---

## Quick Start

### 1. Install

```bash
npm install
npx playwright install chromium
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```
LOCAL_MODE=true
TEST_SCRAPER=gmaps-full        # gmaps-full | gmaps-no-website | phone-enricher
HEADLESS=false                 # false for Stage 1 (watch browser), true for Stage 2+
USE_PROXY=false
```

### 3. Set your test query

Edit `local-test.js` — find the `TEST_INPUTS` object at the top and update:

```js
'gmaps-full': {
  query: 'auto body shop Brooklyn NY',   // ← your search
  maxResults: 5,                          // ← how many listings
},
```

### 4. Run

```bash
node local-test.js
```

Results print to the console **and** save to `results/<scraper-name>.json`. Re-running the same query will skip any business already in the file (deduplication by phone number).

---

## Results Storage

Each scraper writes to its own file:

```
results/
  gmaps-full.json
  gmaps-no-website.json
  phone-enricher.json
```

Deduplication priority:
1. **Phone number** — if two records share a phone, the second is dropped
2. **Name + address** — fallback when phone is null

The files grow with each run. Duplicate businesses are logged and skipped automatically.

---

## Output Schemas

### GMaps Full

```json
{
  "name": "Joe's Auto Repair",
  "phone": "(718) 555-1234",
  "address": "123 Atlantic Ave, Brooklyn, NY 11201",
  "website": "https://joesauto.com",
  "email": "joe@joesauto.com",
  "category": "Auto repair shop",
  "rating": 4.7,
  "reviewCount": 143,
  "hasEmail": true,
  "scrapedAt": "2026-04-16T10:30:00.000Z"
}
```

### GMaps No-Website

```json
{
  "name": "Brooklyn Radiator Works",
  "phone": "(718) 555-9876",
  "address": "456 4th Ave, Brooklyn, NY 11215",
  "category": "Auto parts store",
  "rating": 4.2,
  "reviewCount": 28,
  "scrapedAt": "2026-04-16T10:30:00.000Z"
}
```

### Phone Enricher

```json
{
  "businessName": "Manhattan Dental Studio",
  "website": "https://manhattandental.com",
  "email": "info@manhattandental.com",
  "phone": "(212) 555-4321",
  "enrichmentStatus": "found_via_website",
  "enrichedAt": "2026-04-16T10:30:00.000Z"
}
```

`enrichmentStatus` values: `found_via_website` | `found_via_maps` | `found_via_google` | `not_found`

---

## Development Stages

| Stage | Settings | Purpose |
|---|---|---|
| **1** | headless:false, 5 records, no proxy | Verify selectors, logic, output |
| **2** | headless:true, 20 records, no proxy | Verify speed, no crashes |
| **3** | Apify dev run, proxy, 50 records | Verify proxy + Apify dataset output |
| **4** | Apify production, full proxy pool | Unlimited production runs |

---

## Local Rate Limits (No Proxy)

Google Maps will trigger CAPTCHA after ~20–40 searches on the same IP.

- Keep `maxResults` ≤ 15 per local run
- Wait 30–60 min between sessions on the same IP
- Soft block clears in 1–4 hours; hard block in 24–48 hours
- Stage 3+ uses Apify residential proxies — this is not an issue in production

---

## Geo-Tiling (More Than 120 Results)

Google Maps caps results at ~120 per query. To get more, split by borough/neighborhood:

```js
'gmaps-full': {
  geoTiles: [
    'auto body shop Manhattan NY',
    'auto body shop Brooklyn NY',
    'auto body shop Queens NY',
    'auto body shop Bronx NY',
    'auto body shop Staten Island NY',
  ],
  maxResults: 120,
},
```

Duplicates across tiles are automatically deduplicated by the store.

---

## Apify Deployment

```bash
cd actors/gmaps-full
apify push
```

Each actor has its own `.actor/actor.json`. Repeat for `gmaps-no-website` and `phone-enricher`.

Proxy config is wired in each actor — set `groups: ['RESIDENTIAL']` and `countryCode: 'US'`.
