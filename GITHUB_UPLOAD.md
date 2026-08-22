# GitHub Upload + Cloudflare Pages

এই repository-টি GitHub-এ সরাসরি upload করে Cloudflare Pages-এর Git integration দিয়ে deploy করার জন্য প্রস্তুত।

## GitHub-এ upload
1. GitHub-এ নতুন একটি **private repository** তৈরি করুন।
2. এই repository-র সব file upload করুন।
3. `.env` বা কোনো secret key upload করবেন না। শুধু `.env.example` রাখুন।

## Cloudflare-এ connect
1. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git.
2. GitHub repository নির্বাচন করুন।
3. Framework preset: **None**.
4. Build command: **None / blank**.
5. Build output directory: **/** (repository root).
6. Deploy করুন।

## Secrets
Cloudflare project-এর Settings → Environment variables/Secrets-এ server-side secret values দিন।

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`

`SUPABASE_SERVICE_ROLE_KEY` এবং `TELEGRAM_BOT_TOKEN` GitHub-এ কখনো commit করবেন না।

## পরে update
GitHub-এ code পরিবর্তন করে push করলে Cloudflare Pages Git deployment চালু থাকলে নতুন deployment তৈরি হবে।


V3 FIX: The admin login page no longer performs an anonymous `admin_users` count. It always shows the login form first, then checks the signed-in Supabase user against `public.admin_users` using the authenticated access token. This avoids the RLS false-zero that previously displayed “First Admin Setup” even when an Admin already existed. No new Admin account is required.
