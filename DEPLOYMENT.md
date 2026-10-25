# Deploy the PostgreSQL Data Viewer (Netlify + Render + Neon)

This project has three parts:
- React/Vite frontend: Netlify
- ASP.NET Core 10 API: Render (Docker)
- PostgreSQL database: Neon

The frontend calls the API over HTTPS. Only the backend connects to PostgreSQL.

## A. Prepare the repository

1. Extract this project. The repository root should contain `frontend/`, `backend/`, `netlify.toml`, and this file.
2. Push the contents of `postgres-table-viewer-deploy-ready/` to a GitHub repository. Do not commit real passwords or `.env` files.

## B. Create PostgreSQL on Neon

1. Create a project at https://console.neon.tech/.
2. Open **SQL Editor** for the database and run your `create_mock_data.sql` script (or paste the table-and-insert SQL) to create and populate `public.mock_data`.
3. Open **Connect** and select the correct branch, database, and role. Copy the hostname, database name, username, and password. Keep the password private.

The backend uses Npgsql-style connection-string syntax. In Render, set `ConnectionStrings__Postgres` to a value shaped like this (replace every placeholder):

```text
Host=YOUR_NEON_HOST;Port=5432;Database=YOUR_DATABASE;Username=YOUR_USERNAME;Password=YOUR_PASSWORD;SSL Mode=Require;Trust Server Certificate=true
```

Use the actual host shown by Neon. Do not include the `postgresql://` prefix in this Npgsql-style value. Prefer a separate database role with only the required read access for the application.

## C. Deploy the backend on Render

1. Go to https://dashboard.render.com/ and create **New > Web Service**, connecting your GitHub repository.
2. Set **Root Directory** to `backend/PostgresTableViewer.Api`.
3. Select **Docker** as the runtime. Use `Dockerfile` as the Dockerfile path.
4. Deploy the service. The Dockerfile listens on Render's `PORT` (default 10000).
5. In the service's **Environment** settings, add:
   - `ConnectionStrings__Postgres` = the Npgsql connection string from section B
   - `FrontendOrigin` = temporarily `http://localhost:5173`; update after deploying Netlify
   - `EnableSwagger` = `true` only while you need public demo Swagger docs; otherwise use `false`
6. Redeploy after changing environment variables. Copy the Render public URL, such as `https://your-table-api.onrender.com`.

Check `https://YOUR-API.onrender.com/api/health`. It should return JSON indicating the database is connected. Swagger is available at `/swagger` only when `EnableSwagger=true` or when running in Development. Public Swagger is suitable for a demo, but disable it or add authentication before using this as a production service.

## D. Deploy the frontend on Netlify

1. Go to https://app.netlify.com/ and choose **Add new project / Import an existing project**.
2. Connect the same GitHub repository. Netlify reads `netlify.toml`. If you configure it manually, use base directory `frontend`, build command `npm run build`, and publish directory `dist`.
3. Add this build environment variable in the Netlify site settings:
   - `VITE_API_BASE_URL` = your full Render API URL, e.g. `https://your-table-api.onrender.com` (no trailing slash)
4. Deploy/redeploy the frontend. Vite embeds `VITE_*` variables into the browser bundle, so this variable must be the public API URL only; never put database credentials or other secrets in it.
5. Copy the public Netlify site URL, e.g. `https://your-table-viewer.netlify.app`.

## E. Set CORS to the Netlify domain

Return to Render > your API service > Environment. Update:

- `FrontendOrigin` = the exact Netlify origin, e.g. `https://your-table-viewer.netlify.app` (no path and no trailing slash)

Save and redeploy the API. This allows browser requests from the deployed frontend. If you later add a custom domain, update this setting as well.

## F. Final smoke tests

1. Open `https://YOUR-API.onrender.com/api/health`; confirm `database` is `connected`.
2. Open `https://YOUR-API.onrender.com/api/tables` and confirm `public.mock_data` (or your schema/table) is returned.
3. Open the Netlify website, click **Tables**, and select the table.
4. Click **Download CSV** and confirm the downloaded file opens with the data.
5. If browser requests fail, verify `VITE_API_BASE_URL` in Netlify, `FrontendOrigin` in Render, and the Render logs. Redeploy the frontend after changing `VITE_API_BASE_URL`.

## Important notes

- Free-tier behavior, usage quotas, and availability may change; check each provider's current plan before deploying. A free API service may sleep or cold-start after inactivity.
- Do not connect to PostgreSQL directly from React and never place database credentials in frontend code.
- This demo endpoint lists and reads database tables. Keep the database role read-only, expose only intended schemas, and add authentication/rate limits before sharing sensitive data.
