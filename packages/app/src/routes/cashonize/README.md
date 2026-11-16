# Cashonize WalletConnect connection

Create `packages/app/.env` from `.env.example` and set:

```env
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

Get a Project ID from the WalletConnect/Reown dashboard. The Project ID is public client
configuration. Do not put private keys, seed phrases, or other secrets in this file.

Run PennyPicker with `pnpm --filter app dev`, then open
`http://localhost:5173/cashonize`. Choose **Connect Cashonize** and scan the pairing QR
with Cashonize configured for Chipnet. The session requests the BCH Chipnet namespace,
`bch_getAddresses`, and permission for `bch_signTransaction`; this route only calls
`bch_getAddresses` and displays public `bchtest:` addresses. It does not request or access
wallet keys and does not create, sign, or broadcast transactions.
