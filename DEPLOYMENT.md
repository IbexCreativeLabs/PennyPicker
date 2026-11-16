# Deploying the PennyPicker demo (Cloudflare Pages)

PennyPicker is a **static site**:
- SvelteKit `adapter-static`, with `ssr = false` and `prerender = true`.
- The browser talks directly to the BCH **Chipnet** Electrum servers over WSS (`chipnet.imaginary.cash`) and to the WalletConnect relay.
- No app server, database or persistent process is needed.

The only server-side code is an optional feedback endpoint (`functions/api/feedback.js`). It runs as a Cloudflare Pages Function.

**Why Cloudflare Pages:**
- It deploys private repositories owned by GitHub organizations on the free plan.
- It rebuilds automatically on every push to `main` and gives each branch a preview URL.
- It runs the feedback function next to the static files.
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

## 3. Team feedback endpoint (optional, recommended)

Without configuration, the Feedback button still works: it shows a copyable report and a GitHub-issue link.
To file issues automatically, with no GitHub account needed by testers:

1. On GitHub, go to **Settings → Developer settings → Fine-grained personal access tokens → Generate new token**:
   - Resource owner: **IbexCreativeLabs**. Repository access: **Only select repositories → PennyPicker**.
   - Permissions: **Issues: Read and write**. Nothing else.
   - Expiration: just after the hackathon.
2. In the Cloudflare Pages project, go to **Settings → Variables and Secrets** (Production) and add:
   - `FEEDBACK_GITHUB_TOKEN` = the token, with type **Secret**.
   - `FEEDBACK_GITHUB_REPO` = `IbexCreativeLabs/PennyPicker`.
3. Redeploy (Deployments → Retry deployment), or push any commit.

Issues are titled `[Bug] …`, `[UI problem] …` and so on, and labelled `feedback` plus the type where permissions allow.
The endpoint accepts same-origin requests only, limits size, ignores bot submissions (honeypot field), and removes
`@mentions`.

## 4. Verify the deployment

1. Open the production URL. It should redirect to `/penny-picker` and show the experimental-demo notice.
2. The header shows **Chipnet** and **Demo** badges. The overview checklist loads (Electrum reachable).
3. **Wallet → Connect Cashonize**: pair Cashonize (set to Chipnet) and confirm the address appears.
4. Send one feedback item. It should either file an issue or show the copy fallback.

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
