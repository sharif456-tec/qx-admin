QX Admin Direct Login
- index.html = direct login
- config.js = supplied Supabase project + publishable key
- Login uses Supabase Auth email/password
- Successful login goes to dashboard.html

Important: upload/replace index.html and config.js in the deployed project.
Do not add a service_role/secret key to browser files.
If HTTP 400 remains, check Supabase Authentication > Providers > Email and confirm Email provider is enabled.
