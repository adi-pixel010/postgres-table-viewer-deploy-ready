# PostgreSQL Data Viewer

A starter web app that follows the supplied wireframe, using **React + Vite** for the frontend, **ASP.NET Core 10 / C#** for the read-only API, and **PostgreSQL** as the data source.

## Features

- Sidebar navigation for Tables, Download CSV, and Reset view.
- Fetches accessible base-table names from PostgreSQL metadata.
- Dropdown values display as `schema.table`.
- Renders data in a horizontally scrollable table with 50-row pages (pagination is handled in the browser).
- Downloads the *entire selected table* as UTF-8 CSV, regardless of the currently visible page.
- The data and CSV endpoints each accept only one query parameter: `tableName`.
- Quotes dynamic PostgreSQL identifiers and checks the selected table against PostgreSQL metadata.
- CSV text values are checked for spreadsheet formula injection.

## Requirements

- .NET 10 SDK
- Node.js 20+ (Node 22 recommended)
- PostgreSQL database and a database user with read access to the intended schemas/tables

.NET 10 is used as the current LTS framework. The API uses Npgsql directly for PostgreSQL access.

## 1. Configure PostgreSQL

Edit `backend/PostgresTableViewer.Api/appsettings.json` and set `ConnectionStrings:Postgres`:

```json
{
  "ConnectionStrings": {
    "Postgres": "Host=localhost;Port=5432;Database=your_database;Username=your_readonly_user;Password=your_password"
  },
  "FrontendOrigin": "http://localhost:5173"
}
```

Prefer an environment variable for credentials rather than committing a real password:

**PowerShell**

```powershell
$env:ConnectionStrings__Postgres = "Host=localhost;Port=5432;Database=your_database;Username=your_readonly_user;Password=your_password"
```

**macOS/Linux**

```bash
export ConnectionStrings__Postgres='Host=localhost;Port=5432;Database=your_database;Username=your_readonly_user;Password=your_password'
```

The table picker discovers base tables in non-system schemas that the configured database user can see. The application itself does not create or modify database records.

## 2. Start the C# API

From the project root:

```bash
cd backend/PostgresTableViewer.Api
dotnet restore
dotnet run
```

The API runs at `http://localhost:5080`. Verify it at `http://localhost:5080/api/health`. In Development, Swagger UI is available at `http://localhost:5080/swagger`.

## 3. Start the React frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite development server forwards `/api` requests to the C# API at port 5080.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check API/PostgreSQL connectivity |
| GET | `/api/tables` | List accessible non-system base tables |
| GET | `/api/table-data?tableName=public.customers` | Get the table rows and column names |
| GET | `/api/table-data/csv?tableName=public.customers` | Download the entire selected table as CSV |

Each data endpoint has only one query parameter: `tableName`. Pass a bare name such as `mock_data` when it is unique, or a schema-qualified value such as `public.mock_data` when needed. If a bare name matches multiple accessible schemas, the API returns `409 Conflict` rather than silently choosing the wrong table. The React dropdown sends its displayed `schema.table` value through this one parameter. The data endpoint returns all rows and the React UI paginates them in the browser; for very large tables, consider reintroducing server-side pagination.

## Important production notes

- Use a dedicated PostgreSQL account with **SELECT-only privileges** for the schemas the application should expose. The UI is read-only, but database permissions are the actual security boundary.
- Add authentication/authorization before making this available to other users or exposing it to the internet.
- For large tables, CSV exports can be lengthy because they export all rows. Consider export limits, background jobs, or access controls for very large datasets.
- The table list is metadata-driven and does not expose PostgreSQL system schemas, but visible application schemas should still be restricted through the database user's grants.
- Store secrets outside source control. Avoid using the administrative `postgres` role from the app.

## Troubleshooting

- **API offline in the page:** start the API first and check `http://localhost:5080/api/health`.
- **No tables in the dropdown:** check the database, schema, and table grants. The database user must be able to see the table metadata and select from the table.
- **CORS errors:** keep `FrontendOrigin` set to the exact frontend origin (default `http://localhost:5173`).
- **Connection failures:** check host, port, database, username, password, network access, and PostgreSQL `pg_hba.conf` if relevant.


## Deploy online

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for end-to-end instructions to deploy the React frontend to Netlify, the ASP.NET Core API to Render using Docker, and PostgreSQL to Neon. The frontend supports the `VITE_API_BASE_URL` build variable for the deployed API.
