# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Google OAuth and Supabase

1. In Google Cloud, create a Web OAuth client. Set its authorized redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback` (shown in the Supabase Google provider settings).
2. In Supabase, open **Authentication → Providers → Google**, enable Google, and enter the OAuth client ID and secret.
3. In **Authentication → URL Configuration**, set the production Site URL and add each app origin to Redirect URLs, including `http://localhost:5173/**` for local development.
4. Run `supabase/schema.sql` in the Supabase SQL Editor. It creates the auth-user profile trigger and replaces the public policies with authenticated, owner-scoped policies.
5. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the app. Never put a Supabase service-role key in client-side environment variables.

The app creates a profile for each Google account and stores goal/activity ownership against that profile. Existing rows with a null `user_id` become private to nobody under the new policies. Review them before migrating; only if all unowned rows belong to the first account, assign them after signing in:

```sql
do $$
declare
  owner_profile_id uuid;
begin
  select id into owner_profile_id
  from public.profiles
  where user_id = (select id from auth.users where email = 'YOUR_GOOGLE_EMAIL');

  if owner_profile_id is null then
    raise exception 'No profile found for that Google account';
  end if;

  update public.activities set user_id = owner_profile_id where user_id is null;
  update public.goals set user_id = owner_profile_id where user_id is null;
end $$;
```
