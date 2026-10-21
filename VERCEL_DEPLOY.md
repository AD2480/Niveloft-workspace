# Deploy Niveloft to Vercel

The source folders must be extracted into GitHub. A repository containing only
`niveloft (17).zip` cannot be built by Vercel.

In Vercel, import `AD2480/Niveloft-workspace`, branch `main`, using:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Application / Framework Preset | `Vite` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | `24.x` |

The commands and output directory are also declared in `frontend/vercel.json`.
The lockfile fixes the exact dependency versions for each build.

## Connect the backend

This repository's backend is Java 21 / Spring Boot and uses MySQL. Deploy
`backend/Dockerfile` to a Java or container host and configure its database and
production settings using `backend/.env.production.example` and the deployment
section of `README.md`. Attach persistent storage for uploads.

In Vercel's Environment Variables, set **Production** and **Preview**:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | Your live backend's HTTPS URL followed by `/api` |
| `VITE_SITE_URL` | Your frontend's final HTTPS URL; optional because Vercel supplies its production domain |
| `VITE_OPERATOR_NAME` | Your public operator name |
| `VITE_CONTACT_EMAIL` | Your public support email |

For example, if your backend is `https://your-service.up.railway.app`, use
`https://your-service.up.railway.app/api` for `VITE_API_BASE_URL`. This is a
placeholder example; replace it with your actual backend address.

Set `CORS_ALLOWED_ORIGINS` and `APP_URL` on the backend to your actual frontend
origin, with no trailing slash. Allow only preview origins you intend to test;
use a separate backend/database for preview data when available.

Click **Deploy**. Changing a `VITE_` variable requires another deployment.

Do not set `VITE_TEST_API` or `VITE_USE_MOCK_API`. The production build excludes
the test API. `/api` alone does not connect a backend on Vercel: this project
has no rewrite forwarding API requests to a backend service.

## What was verified locally

The production build can be checked with `VITE_API_BASE_URL=/api npm run build`.
That only checks compilation and bundling; it does not prove a backend is live.
Run `npm test` and `npm run lint` in `frontend` too.

After deployment, check `/`, `/login`, and a direct `/projects/...` link. Then
test account creation, sign-in, creating a project/task, and saving/reloading
against the live backend before treating the whole application as deployed.
