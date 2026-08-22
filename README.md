# QX Admin — GitHub + Cloudflare Pages Ready

This repository is structured for a GitHub-connected Cloudflare Pages project.

## Project structure

```text
QX_Admin_GitHub_READY/
├── index.html
├── _headers
├── .gitignore
├── .env.example
├── supabase_telegram_migration.sql
├── functions/
│   └── api/
│       ├── send-license.js
│       └── telegram-webhook.js
└── README.md
```

## 1. Upload to GitHub

Create a new GitHub repository, for example `qx-admin-dashboard`, then upload **the contents of this folder** (not the outer ZIP file as a single file).

Do not commit real Telegram or Supabase secrets.

## 2. Create the Cloudflare Pages project

Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.

Select the GitHub repository and deploy it.

Recommended settings for this static dashboard:
- Framework preset: None
- Build command: leave empty
- Build output directory: `.`

The `functions/` directory is part of the repository so Cloudflare Pages can deploy the Pages Functions endpoints.

## 3. Add Cloudflare environment variables

In the Pages project, add these under Settings → Environment variables for Production (and Preview if needed):

- `TELEGRAM_BOT_TOKEN` — Secret
- `SUPABASE_URL` — variable
- `SUPABASE_ANON_KEY` — variable
- `SUPABASE_SERVICE_ROLE_KEY` — Secret

Never put `TELEGRAM_BOT_TOKEN` or `SUPABASE_SERVICE_ROLE_KEY` into `index.html` or client-side JavaScript.

## 4. Supabase setup

Run `supabase_telegram_migration.sql` once in Supabase SQL Editor. Review the SQL before running it in production.

## 5. Telegram webhook

After the Cloudflare deployment is live, set the Telegram webhook to:

`https://YOUR-PAGES-DOMAIN.pages.dev/api/telegram-webhook`

The webhook lets the bot receive `/start` and register a user's Telegram chat ID.

## 6. License flow

Applicant → Telegram `/start` → chat ID registration → application → Admin login → Approve → license generation → server-side Telegram delivery.

## Security

The first-admin claim/login logic is application-specific. Use Supabase Auth and RLS for production access control. Do not rely only on a hidden UI button for authorization.
