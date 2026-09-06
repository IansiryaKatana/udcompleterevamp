# Deployment

Unique Distribution is a **TanStack Start** app with SSR. Use one of two build targets depending on where you host.

| Target | Command | Output | Host |
|--------|---------|--------|------|
| **Hostinger / Node** | `npm run build:hostinger` | `.output/server/index.mjs` | Hostinger Node.js, VPS, Railway, etc. |
| **Netlify** | `npm run build:netlify` | `dist/client` + serverless | Netlify |

Local development (unchanged):

```bash
npm install
npm run dev
```

Requires **Node.js 20+**.

---

## Environment variables

Set these in **Netlify → Site configuration → Environment variables** or **Hostinger hPanel → Node app → Environment**:

| Variable | Required |
|----------|----------|
| `VITE_SUPABASE_URL` | Yes |
| `VITE_SUPABASE_ANON_KEY` | Yes |

Optional on Node hosts:

| Variable | Default |
|----------|---------|
| `PORT` | `3000` |
| `HOST` | `0.0.0.0` |

Copy `.env.example` to `.env` for local development.

---

## Netlify

### First-time setup

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In [Netlify](https://app.netlify.com): **Add new site → Import an existing project**.
3. Netlify reads `netlify.toml` automatically:
   - Build command: `npm run build:netlify`
   - Publish directory: `dist/client`
4. Add `VITE_SUPABASE_URL=https://oelolusdbaoyiqkgukib.supabase.co` and `VITE_SUPABASE_ANON_KEY` from [The UD Revamp](https://supabase.com/dashboard/project/oelolusdbaoyiqkgukib/settings/api-keys).
5. Deploy.

### CLI (optional)

```bash
npm install -g netlify-cli   # v17.31+
netlify login
netlify init
npm run build:netlify
netlify deploy --prod
```

### Routing

`@netlify/vite-plugin-tanstack-start` wires SSR and client routes (`/product/...`, `/admin/...`, etc.) to Netlify Functions. No manual `_redirects` file is required.

### Local Netlify-like dev (optional)

```bash
npm run dev:netlify
```

---

## Hostinger (Node.js)

Hostinger **shared PHP-only** plans cannot run this app. Use:

- **Hostinger Business / Cloud** with **Node.js** enabled, or  
- **VPS** with Node 20+

### Build on the server

```bash
cd /path/to/unique-distribution
npm ci
npm run build:hostinger
```

### Run with PM2 (recommended)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

The app listens on `PORT` (default `3000`). Point your domain to this port in Hostinger’s Node.js app settings, or put Nginx/Apache in front as a reverse proxy.

### Hostinger hPanel Node.js app

| Setting | Value |
|---------|--------|
| Node version | 20.x |
| Application mode | Production |
| Application root | project folder |
| Application startup file | `.output/server/index.mjs` |
| Build command | `npm run build:hostinger` |

Set `VITE_*` env vars in the panel before building so they are embedded in the client bundle.

### Apache reverse proxy (if needed)

If Apache serves the domain and Node runs on port 3000, see `hostinger/apache-proxy.example.conf`.

---

## Switching hosts

1. **Netlify → Hostinger**: run `npm run build:hostinger`, deploy `.output/` + `public/` assets, start Node server.
2. **Hostinger → Netlify**: connect repo, set env vars, deploy (uses `build:netlify` from `netlify.toml`).

Both targets use the same codebase; only the build script / `DEPLOY_TARGET` changes.

---

## Supabase after deploy

1. Run pending migrations: `supabase db push`
2. Deploy edge functions listed in `.env.example`
3. In Supabase **Authentication → URL configuration**, add your production site URL (Netlify or Hostinger domain) to redirect allow list
