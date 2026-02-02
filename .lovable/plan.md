
## Plan: Multi-Currency Automated Scanning System

### Current Issue Analysis

After investigating the codebase and database, I found these issues:

| Issue | Current State | Impact |
|-------|--------------|--------|
| **Price data fetching** | Cron job only fetches EUR/USD | Other pairs have stale data (3+ weeks old) |
| **Missing price data** | EUR/CHF, USD/CHF, USD/JPY have no data | Can't scan these pairs |
| **Pattern statistics** | EUR/CHF, EUR/GBP not imported | Win rate weights won't work for these pairs |

**Good news:** The `scan-opportunities` function is already correctly set up to:
- Scan ALL active currency pairs from the database
- Use dynamic weights based on win rates per symbol
- Send Telegram notifications with the symbol included

### Solution Steps

#### 1. Update `fetch-forex-data` Edge Function

Modify the function to support fetching multiple symbols in one request:

```typescript
// New request body options:
{ "timeframe": "1h", "fetchAll": true }  // Fetch all active pairs
// OR
{ "timeframe": "1h", "symbols": ["EUR/USD", "GBP/USD", ...] }
```

**Changes:**
- Add `fetchAll` parameter to fetch all active pairs from `supported_currency_pairs` table
- Add `symbols` array parameter for batch fetching
- Implement sequential fetching with delay to avoid API rate limits (1 second between requests)
- Return aggregated results for all symbols

#### 2. Update Cron Job for Price Fetching

Current cron only passes `{"timeframe": "1h"}` which defaults to EUR/USD.

**Update to:** `{"timeframe": "1h", "fetchAll": true}`

This ensures all 12 active pairs get fresh price data every 15 minutes.

#### 3. Import Pattern Statistics for EUR/CHF and EUR/GBP

The JSON files are in the codebase but need to be imported to the database:
- `src/data/pattern_statistics_EURCHF.json`
- `src/data/pattern_statistics_EURGBP.json`

Use the existing `import-pattern-stats` edge function to import them.

### Technical Details

#### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/fetch-forex-data/index.ts` | Add `fetchAll` and `symbols` parameters, sequential multi-symbol fetching |

#### Database Changes

Run SQL to update the existing cron job:

```sql
SELECT cron.unschedule('fetch-forex-data-every-15min');

SELECT cron.schedule(
  'fetch-forex-data-every-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://vidgzprafrmukuxufpfz.supabase.co/functions/v1/fetch-forex-data',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer ..."}'::jsonb,
    body:='{"timeframe": "1h", "fetchAll": true}'::jsonb
  ) as request_id;
  $$
);
```

#### Pattern Stats Import

Call the import function for each new pair's statistics.

### How the Win Rate Weighting Works (Already Implemented)

The `scan-opportunities` function already correctly implements win rate-based weighting:

```
┌─────────────────────────────────────────────────────────────────┐
│  Pattern Detection with Dynamic Weights                        │
├─────────────────────────────────────────────────────────────────┤
│  1. Detect pattern (e.g., RSI oversold)                        │
│  2. Query pattern_statistics for symbol-specific win rate      │
│  3. Calculate dynamic tier based on actual win rate:           │
│     - Tier 1: >52% win rate → weight 1.3-2.0                   │
│     - Tier 2: 50-52% → weight 1.0                              │
│     - Tier 3: 48-50% → weight 0.3-0.5                          │
│     - Tier 4: <48% → negative weight (penalty)                 │
│  4. Only signal if Tier 1 pattern present + score > 1.5        │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Order

1. **Update `fetch-forex-data` function** - Add multi-symbol support
2. **Deploy and test** - Manually call with `fetchAll: true`
3. **Update cron job SQL** - Change body to include `fetchAll: true`
4. **Import pattern statistics** - For EUR/CHF and EUR/GBP
5. **Verify scanning** - Check that all pairs are being scanned with Telegram notifications
