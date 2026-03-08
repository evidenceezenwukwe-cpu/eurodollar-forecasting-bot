

# Historical Market Data Import System

## Overview

Build a complete historical data ingestion pipeline: a dedicated `historical_price_data` table, a robust edge function for parsing/validating CSV/JSON uploads, and an admin UI tab for uploading files and viewing import results.

## 1. Database Migration

Create the `historical_price_data` table with a unique constraint for deduplication and a composite index for query performance.

```sql
CREATE TABLE public.historical_price_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  timestamp timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume numeric DEFAULT 0,
  source text DEFAULT 'csv_import',
  created_at timestamptz DEFAULT now(),
  UNIQUE (symbol, timeframe, timestamp)
);

CREATE INDEX idx_historical_price_lookup 
  ON public.historical_price_data (symbol, timeframe, timestamp);

-- RLS: public read, service role write
ALTER TABLE public.historical_price_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to historical data"
  ON public.historical_price_data FOR SELECT USING (true);

CREATE POLICY "Allow service role to manage historical data"
  ON public.historical_price_data FOR ALL USING (true) WITH CHECK (true);
```

## 2. Edge Function: `import-historical-data`

Rewrite the existing `supabase/functions/import-historical-data/index.ts` to support:

- **Dual input**: Accept `candles` array (JSON) OR raw `csvData` string
- **CSV parsing**: Split lines, map columns (`timestamp,open,high,low,close,volume`)
- **Validation per row**:
  - Timestamp is valid and not in the future
  - OHLC are numeric
  - `high >= max(open, close)` and `low <= min(open, close)`
- **Timeframe normalization**: Map variants like `1m`, `1min`, `1minute` to canonical `1min`
- **Batch upsert** into `historical_price_data` (not `price_history`) in chunks of 2000
- **Return**: `{ inserted, skipped, invalidRows, timeRange, totalProcessed }`
- **Target table**: `historical_price_data` (new table, not `price_history`)

## 3. Admin UI: `HistoricalDataPanel` Component

New file: `src/components/admin/HistoricalDataPanel.tsx`

Features:
- File input accepting `.csv` and `.json`
- Dropdown selects for currency pair (from `useCurrencyPairs`) and timeframe
- Client-side CSV parsing with `FileReader`
- Chunked upload (10,000 rows per request) to avoid edge function timeouts
- Progress bar showing batch progress
- Results summary: rows inserted, skipped, invalid, time range
- Validation error display

## 4. Admin Page Integration

Update `src/pages/Admin.tsx`:
- Add a 5th tab "Historical Data" 
- Import and render `HistoricalDataPanel`
- Update the `TabsList` grid from `grid-cols-4` to `grid-cols-5`

## Files Changed

| File | Action |
|------|--------|
| Database migration (SQL) | Create `historical_price_data` table + index + RLS |
| `supabase/functions/import-historical-data/index.ts` | Rewrite with CSV support, validation, new target table |
| `src/components/admin/HistoricalDataPanel.tsx` | New — upload UI with progress and results |
| `src/pages/Admin.tsx` | Add "Historical Data" tab |

