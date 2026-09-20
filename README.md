# Closebook

A product homepage, dedicated sign-in page, and dashboard built from your Kalshi API history or realized-P&L CSV. There is no bundled trading
data. Imports replace the previous dataset rather than appending to it.

- Use Settings to choose a time zone, show or hide daily trade counts, toggle
  whole-dollar calendar rounding, and start the week on any day. Preferences
  sync through Supabase account metadata and survive clearing or replacing CSVs.
  Existing uploads supply the time zone until you first save account settings.
- See daily and monthly close counts, P&L, win rate, average P&L per close,
  profit factor, and maximum realized drawdown.
- The dashboard requires a verified Supabase session. Signed-out visitors go to
  the separate sign-in page; dashboard contents stay hidden during verification.
- Email links create accounts and sign returning users in. The latest CSV and
  timezone are saved to the account across devices.
- Clear data deletes the account upload. Signing out preserves it and returns
  to login. Legacy guest data is no longer loaded by the dashboard.

## Local development

Requires Node.js 22+ and Python 3.

```sh
npm ci
npm start
```

Open http://localhost:8000. `npm start` builds the app and serves only `dist/`.
Re-run it after code changes. The build uses the public project settings in `public-config.json` by default.
The old `kalshi_pnl_calendar.html` path redirects to the dashboard.

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
   Add `https://justinhwang24.github.io/pnl-tracker/dashboard.html` and
   `http://localhost:8000/dashboard.html` to allowed Redirect URLs. Email links
   return directly to the dashboard. Keep the Site URL set to the homepage.
4. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` when building. Use the project
   publishable key (or legacy `anon` key). These are public browser configuration;
   never use a secret or `service_role` key. Row-level security protects the data.

For example, in your shell:

```sh
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
export SUPABASE_PUBLISHABLE_KEY='YOUR_PUBLIC_PUBLISHABLE_KEY'
npm start
```

The build uses `public-config.json`; paired shell environment variables override
it. It does not read `.env` files. No SQL migrations
or remote project settings are applied by the build. The sign-in page offers email authentication
when both settings are present. There is no guest dashboard access. Email links both create new accounts and
sign returning users in. Save failures remain visible and offer Retry save;
failed imports keep the previous dataset.

## Kalshi API sync

The dashboard offers **Connect Kalshi** alongside CSV upload. Enter your own
API key ID and RSA private key from [Kalshi profile settings](https://kalshi.com/account/profile),
then select **Sync Kalshi**. Prefer read-only permissions. The app accepts both
PKCS#1 (`RSA PRIVATE KEY`) and PKCS#8 (`PRIVATE KEY`) PEM keys.

The private key is imported into Web Crypto as a non-extractable key and the
text field is cleared. It stays only in memory until navigation, reload, sign-out,
or **Forget credentials**. It is never sent to Supabase, Kalshi, or browser storage.
The key ID and short-lived RSA-PSS request signatures pass through an authenticated
Supabase Edge Function. The function only permits three fixed GET endpoints; it
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
is deployed, sync displays an availability error and CSV upload still works.

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
  must be entered again after leaving the page. Forgetting them keeps imported data;
  **Clear data** removes it. There is no scheduled background sync.

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
   `https://ibieiqzkgklnrsehihoh.supabase.co/auth/v1/callback`.
3. In [Supabase Authentication → Sign In / Providers](https://supabase.com/dashboard/project/ibieiqzkgklnrsehihoh/auth/providers),
   open Google, enable it, and save the client ID and client secret from Google.
   The secret belongs only in Supabase's provider settings, never in this repo.
4. In Supabase URL Configuration, allow
   `https://justinhwang24.github.io/pnl-tracker/dashboard.html` and
   `http://localhost:8000/dashboard.html`. Successful Google login returns there.

See [Supabase's Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
The app uses the same verified session and account storage for Google and email.
Browser tests mock OAuth; actual Google consent requires these provider settings.

### Publish the site

1. Put this directory in its own GitHub repository with default branch `main`.
   If your default branch differs, adjust `.github/workflows/pages.yml`.
2. In repository Settings → Pages, select **GitHub Actions** as the source.
3. The included public configuration targets this Supabase project. To use a
   different project, set both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` under
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
| Average P&L / trade | Net realized P&L divided by close-row count. |
| Profit factor | Sum of positive P&L divided by absolute sum of negative P&L. `∞` means gains with no losses; `—` means no gains or losses. |
| Max drawdown | Largest peak-to-trough drop in cumulative realized P&L, ordered by close time and starting at zero for the selected month. Equal timestamps are combined. Excludes unrealized positions and prior-month equity. |

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
