

## Strategy Profile Presets — Implementation Plan

### Current State
- **Database**: `strategy_profiles` table exists with 4 seeded presets (Swing, Intraday, Scalp, Prop-Compliant). RLS policies are in place.
- **Scan engine**: `scan-opportunities/index.ts` still uses hardcoded timeframes (`1d`, `4h`, `15min`) in `analyzeCRT()` (line 649). No `profile_id` support.
- **UI**: No profile selector component exists. No references to `strategy_profiles` anywhere in the frontend code.
- **Feature access**: `plan_features` already gates `opportunities` — we can gate strategy profiles similarly for funded/lifetime users.

### Implementation Steps

#### 1. Modify `scan-opportunities` edge function
In `supabase/functions/scan-opportunities/index.ts`:

- Add a `StrategyProfile` interface and `DEFAULT_PROFILE` constant (htf=`1d`, trigger=`4h`, entry=`15min`)
- In the main handler (~line 1111), read `body.profile_id`. If provided, query `strategy_profiles` table by ID to load the profile. Fallback to `DEFAULT_PROFILE`.
- Refactor `analyzeCRT(supabase, symbol)` → `analyzeCRT(supabase, symbol, profile)`:
  - Replace hardcoded `'1d'`/`'4h'`/`'15min'` with `profile.htf`/`profile.trigger_tf`/`profile.entry_tf`
  - Apply `profile.settings.min_confidence` and `profile.settings.max_risk_pips` as post-validation filters
- Pass the resolved profile through `scanSymbol()` down to `analyzeCRT()`

#### 2. Create `useStrategyProfiles` hook
New file `src/hooks/useStrategyProfiles.ts`:
- Fetch all shared profiles + user's own profiles from `strategy_profiles`
- Track `activeProfileId` in state (default: Swing preset ID)
- Expose `profiles`, `activeProfile`, `setActiveProfile`

#### 3. Create `StrategyProfileSelector` component
New file `src/components/trading/StrategyProfileSelector.tsx`:
- Dropdown/select showing available profiles with name and TF preview (e.g., "Swing — D1 → H4 → M15")
- Shows HTF/Trigger/Entry badges for the selected profile
- Gated behind `hasFeature('opportunities')` or funded plan check

#### 4. Integrate into Dashboard
In `src/pages/Dashboard.tsx`:
- Import `useStrategyProfiles` hook
- Add `StrategyProfileSelector` above or beside the OpportunitiesPanel
- Pass `activeProfileId` to `triggerScan` → which passes it to the edge function body
- Update `useOpportunities.triggerScan` to accept optional `profileId` parameter

#### 5. Update `useOpportunities` hook
In `src/hooks/useOpportunities.ts`:
- Modify `triggerScan` signature: `triggerScan(symbols?: string[], profileId?: string)`
- Include `profile_id` in the edge function invocation body

#### 6. Admin preset management panel
New file `src/components/admin/StrategyProfilesPanel.tsx`:
- List all shared profiles with edit/delete
- Form to create new global preset (name, htf, trigger_tf, entry_tf, settings JSON)
- Add to the Admin page

### Technical Details

```text
Flow: User selects profile → clicks Scan → 
  useOpportunities.triggerScan(symbols, profileId) →
  scan-opportunities edge function receives profile_id →
  loads profile from DB (or falls back to default) →
  analyzeCRT uses profile.htf/trigger_tf/entry_tf
```

Edge function profile resolution (pseudocode):
```typescript
const DEFAULT_PROFILE = { htf: '1d', trigger_tf: '4h', entry_tf: '15min', settings: {} };

let profile = DEFAULT_PROFILE;
if (body.profile_id) {
  const { data } = await supabase.from('strategy_profiles').select('*').eq('id', body.profile_id).single();
  if (data) profile = data;
}
// Then: analyzeCRT(supabase, symbol, profile)
```

No new database migrations needed — the table and seed data already exist.

