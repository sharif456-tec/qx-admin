# QX Admin + Cloudflare License Gateway — READY

This package contains the Cloudflare Pages admin dashboard and the server-side license/Telegram gateway. It is designed to work with the companion Kiwi extension package.

## What happens

1. Extension registration form → `POST /api/register` on this Cloudflare project.
2. Cloudflare stores the pending request in Supabase.
3. Admin logs in and sees the request in **Pending**.
4. Admin clicks **Approve**. Cloudflare verifies the Admin session, then calls Supabase `admin_approve_license`.
5. Supabase creates the active license and returns the license key. Only after that confirmation does Cloudflare send the key automatically to the linked Telegram Chat ID.
6. The user enters the key in the extension. Activation and heartbeat are checked by Supabase RPCs.

## Files

```text
QX_Admin_CLOUDFLARE_READY/
├── index.html
├── _worker.js
├── _headers
├── .env.example
├── .gitignore
├── supabase_license_migration.sql
└── README.md
```

## Supabase setup

Run `supabase_license_migration.sql` once in Supabase SQL Editor. It creates the license requests, licenses, devices and Telegram tables plus the protected Admin/activation RPCs.

## Cloudflare variables

Set these in Cloudflare Pages/Workers environment variables: 

- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_ANON_KEY` — publishable/anon key (variable)
- `SUPABASE_SERVICE_ROLE_KEY` — **Secret**
- `TELEGRAM_BOT_TOKEN` — **Secret**

Never put service-role or Telegram bot secrets into `index.html` or the extension.

## Direct upload

This package uses Cloudflare Pages advanced-mode `_worker.js`, so it is intentionally packaged for a single Cloudflare upload rather than a `/functions` directory. Cloudflare's current Pages docs say dashboard drag-and-drop supports a `_worker.js` advanced-mode Worker, while a `/functions` directory requires Wrangler for deployment.

You can therefore use Cloudflare Pages **Direct Upload → Drag and drop** with this ZIP. After deployment, set the environment variables above and configure the Telegram webhook to:

`https://YOUR-PAGES-DOMAIN.pages.dev/api/telegram-webhook`

## Extension connection

After you know the actual Pages hostname, replace this placeholder in the companion extension package:

`YOUR-CLOUDFLARE-PAGES-DOMAIN.pages.dev`

It appears in `background.js` and `manifest.json`. Reload the extension after that one-time change.

## Security

- Admin approval is server-verified.
- A normal authenticated user cannot call the Admin approval RPC successfully.
- License creation occurs in Supabase before Telegram delivery.
- If Telegram delivery fails after approval, the license remains in Supabase and the Admin dashboard has **Resend Telegram**.
- License activation/device binding is enforced in Supabase, not only in browser JavaScript.


V3 FIX: The admin login page no longer performs an anonymous `admin_users` count. It always shows the login form first, then checks the signed-in Supabase user against `public.admin_users` using the authenticated access token. This avoids the RLS false-zero that previously displayed “First Admin Setup” even when an Admin already existed. No new Admin account is required.
