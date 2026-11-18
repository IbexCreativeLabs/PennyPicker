# Deploying the PennyPicker demo (Cloudflare Pages)

**Status (2026-11-17): live at https://pennypicker.pages.dev.** Project `pennypicker`, production branch `main`, with the settings below. The Reown allowlist is empty; set `ADMIN_PASSWORD` for the admin area (section 3).

PennyPicker is a **static site**:
- SvelteKit `adapter-static`, with `ssr = false` and `prerender = true`.
- The browser talks directly to the BCH **Chipnet** Electrum servers over WSS (`chipnet.imaginary.cash`) and to the WalletConnect relay.
- No app server, database or persistent process is needed.

The only server-side code is the admin password check (`functions/_middleware.js`), a Cloudflare Pages Function.

**Why Cloudflare Pages:**
- It deploys private repositories owned by GitHub organizations on the free plan.
- It rebuilds automatically on every push to `main` and gives each branch a preview URL.
- It runs the admin middleware next to the static files.
- It needs no hosting configuration changes in the app.

## 1. Create the Pages project (one-time, needs your Cloudflare account)

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorise the Cloudflare GitHub app for **IbexCreativeLabs**, and grant it access to the `PennyPicker` repository only.
3. Select `IbexCreativeLabs/PennyPicker`. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Project name | `pennypicker` (gives `https://pennypicker.pages.dev`; pick another name if it is taken) |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | `pnpm app:build` |
   | Build output directory | `docs` |
   | Root directory | *(leave empty: repository root, so `functions/` is found)* |

4. Under **Environment variables** (set for both Production and Preview), add:

   | Variable | Value | Notes |
   | --- | --- | --- |
   | `NODE_VERSION` | `22` | |
   | `PNPM_VERSION` | `10.6.3` | Matches `packageManager` |
   | `VITE_WALLETCONNECT_PROJECT_ID` | *your Reown project ID* | Copy it from your local `packages/app/.env`. It is a public client ID, embedded in the site at build time |

5. Click **Save and Deploy**. The first build takes about 2–4 minutes. Each push to `main` redeploys production, and other branches get preview URLs.

The market identifiers (PUSD category and oracle operator) are committed in
`packages/app/src/lib/pennypicker/deployment.ts`, so no extra variables are needed. The app finds the oracle category
automatically from the operator's oracle contract once oracle genesis exists. It only accepts an oracle that the
operator's own address created. `VITE_PENNYPICKER_*` variables still override these values if you set them.

## 2. WalletConnect allowed domains (Reown dashboard)

At dashboard.reown.com, open the project whose ID you use, then its allowed-domains (allowlist) settings:

- If the allowlist is **empty**, all origins are allowed and the deployed site works without changes. Reown recommends setting one anyway.
- If it is **not empty**, connections from unlisted origins are **denied**. Add:
  - `https://pennypicker.pages.dev` (your production URL)
  - `https://*.pennypicker.pages.dev` (branch and commit preview URLs)
- `localhost` is always allowed, so local development keeps working.
- Changes take about **15 minutes** to apply.

The app sends `window.location.origin` as its WalletConnect metadata URL, so Cashonize shows the real site address in its approval prompts.

## 3. Admin password (required for /admin)

The admin area (`/admin`, `/admin/token`, `/admin/simulator`: setup progress, genesis tools, simulator) is protected
by HTTP Basic auth in `functions/_middleware.js`. Until a password is set, `/admin` answers 503 (locked).

1. In the Cloudflare Pages project, go to **Settings → Variables and Secrets** (Production) and add
   `ADMIN_PASSWORD` with type **Secret** (optionally `ADMIN_USER`, default `admin`).
2. Redeploy (Deployments → Retry deployment), or push any commit.

`static/_routes.json` limits the Function to `/admin*`, so public pages are served as plain static files.
This hides admin tools from visitors; it is not a security boundary for on-chain actions, which always need the
user's own wallet.

## 4. Verify the deployment

1. Open the production URL. The Exchange loads directly at `/` and shows the experimental-demo notice.
2. The header shows the stablecoin selector and the **Demo** badge. `/admin` asks for the admin password.
3. **Wallet → Connect Cashonize**: pair Cashonize (set to Chipnet for PennyPickerUSD, or mainnet for ParyonUSD) and confirm the address appears.
4. Old `/penny-picker/...` links redirect (`static/_redirects`).

## 5. Going live on mainnet (ParyonUSD)

The mainnet market uses the same contracts as Chipnet, with the real ParyonUSD token
(`2469acc5…2544`). **Status 2026-11-18: done.** The price record is deployed and `MAINNET_WRITES_COMMITTED = true`; the
steps below are kept for redeploying. Originally the build shipped it **view only**, with the switch off in
`packages/app/src/lib/pennypicker/deployment.ts` stops every mainnet signature and broadcast,
in the UI and in `chain.ts`. Each step below spends real BCH and needs the project owner's approval.

1. **Operator wallet.** Use a dedicated mainnet Cashonize wallet holding a few thousand sats. It needs a
   BCH-only coin at output index 0 (any payment *to* the wallet lands there).
2. **Enable writes in a local build only.** Set `MAINNET_WRITES_ENABLED = true` and run `pnpm --filter app dev`.
3. **Create the price record.** Select ParyonUSD, connect the operator wallet, open **Oracle → Create the
   oracle**, review, sign and broadcast. This costs about 1,000 sats kept in the record plus the fee.
4. **Commit the identifiers.** Copy the new oracle category and the operator key hash (Oracle → Identity) into
   `MAINNET_DEPLOYMENT` in `deployment.ts`.
5. **Choose the cap.** `MAINNET_MAX_ORDER_UNITS` (default 2,500 = 25.00 PUSD per order) applies to every new order.
6. **Ship it.** Commit with `MAINNET_WRITES_ENABLED = true` and push. The ParyonUSD market turns *live*.
7. **Smoke test with small amounts.** One ask, one bid, one fill and one cancel; record the txids in `PROJECT_STATUS.md`.

`pnpm dlx tsx scripts/pennypicker-mainnet-check.ts` (from `packages/app`) runs a read-only readiness check
against mainnet: it connects, finds ParyonUSD, and verifies the live oracle message.

## Local equivalents

```sh
pnpm app:build                                   # static site → ./docs
pnpm dlx wrangler@3 pages dev docs --port 8788   # serve it with the Pages runtime + functions
```

## Notes

- `.env` is never committed. All `VITE_*` values end up public in the built JavaScript, so never put secrets in them.
- The inherited Vox GitHub workflows, which deployed to `vox.cash` and `unspent.dev` via GitHub Pages, were removed.
  `.github/workflows/pennypicker-ci.yml` runs the covenant tests and the production build on every push instead.
- Response headers (`nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, immutable asset caching) come from
  `packages/app/static/_headers`.
