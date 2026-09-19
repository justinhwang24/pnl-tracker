# Kalshi P&L Calendar

A dashboard built from your Kalshi realized-P&L CSV. There is no bundled trading
data. Uploads replace the previous CSV rather than appending or deduplicating it.

- Select an IANA time zone to regroup closes, with daylight saving time handled
  automatically. The selected zone is saved alongside your CSV.
- See daily and monthly close counts, P&L, win rate, average P&L per close,
  profit factor, and maximum realized drawdown.
- Guests retain their latest upload in this browser's local storage.
- With Supabase configured, email-link accounts retain their latest CSV and
  timezone across devices. Each user can access only their own database row.
- Clear data deletes the saved CSV from the current account or guest browser.
  Signing out leaves the account upload saved, clears it from the display, and
  restores the separate guest workspace. Guest files are not automatically copied
  into an account; upload again after signing in to save them there.

## Local development

Requires Node.js 22+ and Python 3.

```sh
npm ci
npm start
```

Open http://localhost:8000. `npm start` builds the app and serves only `dist/`.
Re-run it after code changes. With no backend settings it runs in guest mode.
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
   Add that exact URL and `http://localhost:8000/` to allowed Redirect URLs.
4. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` when building. Use the project
   publishable key (or legacy `anon` key). These are public browser configuration;
   never use a secret or `service_role` key. Row-level security protects the data.

For example, in your shell:

```sh
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
export SUPABASE_PUBLISHABLE_KEY='YOUR_PUBLIC_PUBLISHABLE_KEY'
npm start
```

The build reads shell environment variables, not `.env` files. No SQL migrations
or remote project settings are applied by the build. The account form appears
only when both settings are present. Email links both create new accounts and
sign returning users in. Save failures remain visible and offer Retry save;
failed imports keep the previous dataset.

## Deploy to GitHub Pages

1. Put this directory in its own GitHub repository with default branch `main`.
   If your default branch differs, adjust `.github/workflows/pages.yml`.
2. In repository Settings → Pages, select **GitHub Actions** as the source.
3. In Settings → Secrets and variables → Actions → Variables, add
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` using the values above.
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

- `index.html`, `styles/`: page structure and responsive styles.
- `src/app.js`: UI events, state, and save/restore coordination.
- `src/csv.js`, `src/timezone.js`, `src/analytics.js`, `src/pnl.js`: parsing,
  timezone grouping, metrics, and month filtering.
- `src/views/`: calendar, statistics, table, and canvas chart.
- `src/backend.js`, `src/storage.js`, `src/config.js`: Supabase client, account
  and guest persistence, and build configuration.
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

To include account-flow tests against the mocked Supabase API:

```sh
SUPABASE_URL=https://pnl-test.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_browser_test npm run test:browser
npm run build
```

The second command restores the build with your normal environment settings;
the mock configuration is only for testing, never deployment.
