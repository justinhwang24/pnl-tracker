# Closebook

A product homepage, dedicated sign-in page, and dashboard built from your Kalshi API history or realized-P&L CSV. There is no bundled trading
data. Imports replace the previous dataset rather than appending to it.

- Use Settings to choose a time zone, show or hide daily trade counts, toggle
  whole-dollar calendar rounding, and start the week on any day. Preferences
  sync through Supabase account metadata and survive replacing CSVs.
  Existing uploads supply the time zone until you first save account settings.
- See daily, monthly, and yearly close counts, P&L, win rate, geometric average return per close,
  profit factor, and maximum realized drawdown in dollars.
- The dashboard requires a verified Supabase session. Signed-out visitors go to
  the separate sign-in page; dashboard contents stay hidden during verification.
- Email links create accounts and sign returning users in. The latest CSV and
  timezone are saved to the account across devices.
- Signing out preserves the account upload and returns to login. Legacy guest
  data is no longer loaded by the dashboard.

The dashboard uses a **Profile** dropdown for Settings and Sign Out. Kalshi
connection controls live in Settings; dashboard Connect Kalshi opens that section.
Refresh Kalshi imports new history directly from the dashboard. A successful connection returns to the dashboard.
Signed-in homepage visitors are redirected to the dashboard.
Routine account/import summaries and the CSV upload button are hidden; existing
CSV datasets still restore. Refresh reuses a non-extractable signing key stored in this browser across navigation.
Settings displays “Kalshi API connected” and a disconnect action. Save/load errors
and retry actions remain visible.

## Local development

Requires Node.js 22+ and Python 3.

```sh
npm ci
cp .env.example .env
# Fill in your Supabase project values in .env.
npm start
```

Open http://localhost:8000. `npm start` builds the app and serves only `dist/`.
Re-run it after code changes. The build reads Supabase settings from the gitignored `.env` file.
The old `kalshi_pnl_calendar.html` path redirects to the dashboard.
The main pages use `/dashboard/`, `/settings/`, and `/auth/` routes. The old
`.html` addresses remain available for existing bookmarks and auth callbacks.

## Supabase setup

1. Create or choose a Supabase project and run [supabase/schema.sql](supabase/schema.sql)
   in its SQL editor. It creates `pnl_uploads`, enables row-level security, and
   grants authenticated users read/write/delete access only to their own row.
   The raw CSV text, filename, and timezone are stored together so replacing the
   latest upload is a single atomic operation. Uploads are limited to 2 MB.
2. Enable the Email provider in Authentication and allow new user signups if
   others should be able to create accounts. The default magic-link email
   template works with the app. Configure a production email sender before
   inviting users; Supabase's default email service has recipient/rate limits.
3. Under Authentication → URL Configuration, set Site URL to your final Pages
   URL, including the repository path, such as `https://OWNER.github.io/REPO/`.
   Add both `https://justinhwang24.github.io/pnl-tracker/dashboard.html` and
   `http://localhost:8000/dashboard.html` to allowed Redirect URLs. Also add the
   trailing-slash variants if you use the clean routes:
   `https://justinhwang24.github.io/pnl-tracker/dashboard/` and
   `http://localhost:8000/dashboard/`. Keep Site URL set to the deployed homepage.
4. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` when building. Use the project
   publishable key (or legacy `anon` key). These are public browser configuration;
   never use a secret or `service_role` key. Row-level security protects the data.

For example, in `.env`:

```sh
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

The build loads `.env`; shell or CI environment variables override its values.
Both settings are required. `.env` is never committed or copied into `dist/`;
the public URL and publishable key are embedded in the browser bundle. No SQL migrations
or remote project settings are applied by the build. The sign-in page offers email authentication
when both settings are present. There is no guest dashboard access. Email links both create new accounts and
sign returning users in. Save failures remain visible and offer Retry save;
failed imports keep the previous dataset.

## Kalshi API sync

Settings offers **Kalshi connection**. The dashboard shows **Connect Kalshi**,
switching to a top-level **Refresh Kalshi** button after connecting. Enter your own
API key ID and RSA private key from [Kalshi profile settings](https://kalshi.com/account/profile),
then select **Connect Kalshi**. Prefer read-only permissions. The app accepts both
PKCS#1 (`RSA PRIVATE KEY`) and PKCS#8 (`PRIVATE KEY`) PEM keys.

The private key is imported into Web Crypto as a non-extractable key and the
text field is cleared. The CryptoKey and key ID are stored in IndexedDB, scoped to the signed-in user,
until **Disconnect Kalshi** or sign-out. The PEM is never persisted or sent to Supabase or Kalshi.
The key is non-exportable, but same-origin browser code can use it to sign requests.
The key ID and short-lived RSA-PSS request signatures pass through an authenticated
Supabase Edge Function. The function only permits six fixed GET endpoints (fills, settlements, balance, and current/historical market metadata); it
cannot place orders. Do not add request-body logging to this function.

### Enable the backend

Deploy the included function to the same Supabase project used by the frontend:

```sh
supabase login
supabase functions deploy kalshi-read --project-ref YOUR_PROJECT_REF
```

The included `supabase/config.toml` disables the gateway JWT check because the
handler validates every caller's bearer token using Supabase Auth `/auth/v1/user`.
It rejects unauthenticated requests before contacting Kalshi. `SUPABASE_URL` and
`SUPABASE_ANON_KEY` are supplied by the Supabase runtime; no Kalshi secrets or new
database tables are needed. Then build/publish the frontend using the existing
Pages workflow. Deploying Pages alone does **not** deploy the function. Until it
is deployed, sync displays an availability error. Existing saved data remains available.
Redeploy `kalshi-read` for balance and market-name support; the previous function
allowlist rejects these additional reads. No database migration is required.

### Import behavior and limitations

- Sync is manual and reads all available historical fills, recent fills, and
  settlements for the primary account. It handles pagination and duplicate fill
  IDs across the live and historical tiers. Subaccounts are excluded.
- Results are **FIFO estimates**, labeled in the dashboard. Opposing exposure
  closes the oldest open lots, including partial closes and position reversals.
  Entry and exit fill fees are allocated by quantity; open-lot fees are deferred
  until closing. Settlements use actual revenue and the remaining FIFO basis.
  Settlement cumulative trading fees are not deducted again.
  Gross YES/NO settlement quantities are reconciled by their net exposure.
  Paired collateral already recognized by FIFO closes is removed from gross
  settlement payouts, so it is not counted twice. Net payouts are preserved.
- One closing fill or nonempty settlement counts as one close. This can differ
  from Kalshi's realized-P&L export in cost-basis method, rounding, and row counts.
  Use the CSV for the figures and close grouping in Kalshi's report.
- Missing fields, mismatched settlement quantities, empty histories, upstream
  errors, or pagination limits reject the import and preserve existing data.
  Each endpoint is limited to 100 pages of up to 1,000 records. The normalized
  results must fit the existing 2 MB account limit.
- The imported timestamps and P&L are saved through the existing account storage.
  Repeat sync replaces the dataset; it does not accumulate duplicates. Credentials
  persist in this browser across navigation. Disconnecting keeps imported data.
  There is no scheduled background sync.
- Refresh also reads primary-account cash and open-position value from `/portfolio/balance`.
  Cent amounts are converted to dollars; `balance_dollars`, when present, preserves finer precision.
  Cash plus open-position value is shown as total equity with the fetch timestamp.
- Market titles are fetched in batches of 25 from `/markets`, with `/historical/markets`
  for archived tickers, and reused from previous imports. Missing titles retain the ticker
  as a secondary identifier. Balance/name failures do not discard valid trade history.
- Names and the latest balance snapshot are saved as optional fields in the existing CSV
  record in Supabase. Refresh older imports to populate them. A balance failure displays
  “Balance unavailable”; no old snapshot is silently passed off as a current balance.

References: [Kalshi authentication](https://docs.kalshi.com/getting_started/api_keys),
[fill direction](https://docs.kalshi.com/getting_started/order_direction),
[historical data](https://docs.kalshi.com/getting_started/historical_data),
[settlements](https://docs.kalshi.com/api-reference/portfolio/get-settlements),
[Supabase deployment](https://supabase.com/docs/guides/functions/deploy).

## Deploy to GitHub Pages

### Enable Google sign-in

The login page includes **Continue with Google**. Enable the provider before
using it; until then the page offers email login with an availability message.

1. In [Google Auth Platform](https://console.cloud.google.com/auth/clients),
   configure your app's branding and audience, then create an OAuth client with
   application type **Web application**. For testing, add your Google account
   as a test user if the audience is External and the app is in Testing.
2. Add `https://justinhwang24.github.io` and `http://localhost:8000` as authorized
   JavaScript origins. Add this authorized redirect URI:
   `https://YOUR_PROJECT.supabase.co/auth/v1/callback`.
3. In your Supabase project's Authentication → Sign In / Providers,
   open Google, enable it, and save the client ID and client secret from Google.
   The secret belongs only in Supabase's provider settings, never in this repo.
4. In Supabase URL Configuration, allow
   `https://justinhwang24.github.io/pnl-tracker/dashboard.html` and
   `http://localhost:8000/dashboard.html`. Also add
   `http://localhost:8000/dashboard/` if using clean local routes. Successful
   Google login returns to the origin that started it.

See [Supabase's Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
The app uses the same verified session and account storage for Google and email.
Browser tests mock OAuth; actual Google consent requires these provider settings.

### Publish the site

1. Put this directory in its own GitHub repository with default branch `main`.
   If your default branch differs, adjust `.github/workflows/pages.yml`.
2. In repository Settings → Pages, select **GitHub Actions** as the source.
3. Set both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` under
   Settings → Secrets and variables → Actions → Variables.
4. Push to `main` or run **Deploy P&L tracker to GitHub Pages** manually from
   Actions. The workflow installs dependencies, runs unit tests, builds the app,
   and publishes only `dist/`. It reports the final URL.
5. Set the matching Supabase Site URL and Redirect URL, then test email sign-in,
   upload, reload, sign-out, and sign-in on a second browser/device.

The build explicitly copies only HTML, styles, and the bundled JavaScript.
Local CSV files, tests, SQL, and source configuration are excluded from the
Pages artifact. `.gitignore` also excludes CSVs and environment files. Use this
workflow rather than publishing the repository root.

Before making accounts available, verify with two separate users that each
restores their own upload and cannot query or alter the other's `user_id`.
The automated account tests use a mock API; live email delivery and database
policy enforcement require a configured Supabase project.

References: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[Supabase email authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## How metrics are calculated

All metrics cover the displayed month in the selected timezone and use
`realized_pnl_with_fees_dollars` (already net of fees).
For API imports, this field contains reconstructed FIFO P&L, and each row is
one closing fill or nonempty settlement as described above.

| Metric | Definition |
| --- | --- |
| Closed trades | Number of valid CSV close rows, including settlements. Not individual fills or `quantity_fp` contracts. |
| Win rate | Positive-P&L rows divided by all valid rows, including breakeven rows. |
| Average % / trade | Geometric mean of growth factors (1 + net P&L / entry cost), minus 1. Entry cost includes entry fees. Requires positive entry costs and finite returns no lower than −100% for every close; otherwise displays a dash. Any −100% close makes the geometric average −100%. |
| Profit factor | Sum of positive P&L divided by absolute sum of negative P&L. `∞` means gains with no losses; `—` means no gains or losses. |
| Max drawdown | Largest dollar peak-to-trough drop in cumulative realized P&L in the selected period, starting at $0. Equal close timestamps are grouped. |
| Estimated account return | Latest cash + open-position value, less all realized P&L from the first selected close onward, estimates starting equity. Selected-period P&L divided by this starting equity gives the estimated period return. Later-period trades are subtracted too, so past months do not use today's equity as their starting balance. |
| Estimated account return / close | Geometric mean account growth: `(ending equity / starting equity)^(1 / close count) - 1`. Separate from the main geometric return on trade entry cost. |
| Estimated account drawdown | Largest `(peak equity - equity) / peak equity` on the inferred equity curve for the period. Simultaneous closes are grouped. Dollar drawdown remains the primary metric. |

Account estimates assume no deposits, withdrawals, transfers, or changes in open-position
valuation across the reconstructed interval. Today's balance alone cannot identify those
historical changes; these are explicitly labeled estimates, not cash-flow-adjusted returns.
Nonpositive inferred starting equity or a negative inferred equity path makes the estimates
unavailable. Estimates are hidden for imports without a balance snapshot.

API imports retain entry costs, market tickers/titles, position side, close type, and closed contract quantities. Older imports need a refresh to populate these fields. CSVs may supply `entry_cost_dollars`, `ticker`, `market_title`, and `quantity`; missing cost data is never inferred from P&L. Monthly days expose close times, markets, quantities, P&L, and available returns on hover, keyboard focus, or tap. Recap cards stay within the viewport and support Escape to dismiss. Today has a subtle outline based on the calendar timezone. Skeletons cover session verification and initial data loading.

Empty months show dashes rather than invented performance values. The CSV needs
`close_timestamp` with an explicit `Z` or UTC offset and
`realized_pnl_with_fees_dollars`. Invalid rows are skipped with a visible count;
an upload with no valid rows is rejected. Contract sizes do not weight win rate.

## Structure

- `index.html`: public product homepage (Closebook is the working brand).
- `dashboard.html`: upload, analytics, and account workspace.
- `settings.html`, `src/settings.js`, `src/preferences.js`: account calendar preferences.
  These use auth user metadata and require no database migration.
- `auth.html`, `src/auth.js`: dedicated email sign-in and dashboard redirect.
- `styles/`: shared responsive styles.
- `src/app.js`: UI events, state, and save/restore coordination.
- `src/kalshi.js`: in-memory request signing, history pagination, and FIFO reconstruction.
- `supabase/functions/kalshi-read/`: authenticated proxy for fixed Kalshi read endpoints.
- `src/csv.js`, `src/timezone.js`, `src/analytics.js`, `src/pnl.js`: parsing,
  timezone grouping, metrics, and month filtering.
- `src/views/`: calendar, statistics, table, and canvas chart.
- `src/backend.js`, `src/storage.js`, `src/config.js`: Supabase client, account
  persistence, and build configuration.
- `supabase/schema.sql`: database table and access policies.
- `scripts/build.mjs`: bundled static build with an explicit asset allowlist.
- `.github/workflows/pages.yml`: Pages deployment.

## Validation

```sh
npm test
npm run build
npm run test:browser
```

Browser tests use installed Google Chrome locally. In CI they use Playwright's
Chromium (`npx playwright install --with-deps chromium`). All test data is
synthetic and is excluded from the site build.

To run the dashboard and account-flow tests against the mocked Supabase API:

```sh
SUPABASE_URL=https://pnl-test.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_browser_test npm run test:browser
npm run build
```

The second command restores the build with your normal environment settings;
the mock configuration is only for testing, never deployment.
