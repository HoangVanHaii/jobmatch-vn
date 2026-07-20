# Database Setup (Local)

Quick local setup for the JobMatch VN database. The schema lives in
[versioned SQL migrations](../backend/src/db/migrations/) and is applied in
order by the bootstrap script or by `npm run db:migrate`.

## TL;DR

```bash
# 1. Make sure PostgreSQL (14+) is running on localhost:5432
# 2. From the backend folder, run the one-shot bootstrap:
cd backend
./scripts/setup-local-db.sh                       # macOS / Linux / WSL / Git Bash
# or on native Windows PowerShell:
./scripts/setup-local-db.ps1                       # password is prompted, or:
./scripts/setup-local-db.ps1 -SuperPassword 123456

# 3. Copy env + start the API:
cp .env.example .env
npm install
npm run dev
```

The script creates the app role/database and applies every migration. It is
**idempotent** — safe to re-run (it drops & recreates the dev DB).

## What the script creates

| Item      | Value                |
|-----------|----------------------|
| Database  | `jobmatch_vn`        |
| User      | `jobmatch`           |
| Password  | `jobmatch_dev_pwd`   |
| Host/Port | `localhost:5432`     |

Connection string (matches `backend/.env.example` and `docker-compose.yml`):

```
postgresql://jobmatch:jobmatch_dev_pwd@localhost:5432/jobmatch_vn
```

## Option B — Docker (zero-install, includes pgvector)

If you don't want to install PostgreSQL locally, the project ships a
`docker-compose.yml` that runs Postgres **with pgvector preinstalled**:

```bash
docker compose up -d postgres redis minio mailhog
# DB is now on localhost:5432, same credentials as above.
# Still apply the schema once:
docker compose exec postgres psql -U jobmatch -d jobmatch_vn \
  -f /docker-entrypoint-initdb.d/0000_init.sql
```

## Inspecting the database (DBeaver / pgAdmin / TablePlus)

1. New connection → **PostgreSQL**
2. Host `localhost`, Port `5432`, Database `jobmatch_vn`,
   User `jobmatch`, Password `jobmatch_dev_pwd`
3. Test → Finish. Tables live under **Schemas → public → Tables**.

> If you connected to an older `jobmatchvn` database earlier, switch to
> `jobmatch_vn` — that is the canonical name now.

## pgvector note

The `embeddings` table (used by AI vector-search / CV-JD matching) requires
the **pgvector** extension. If pgvector is not installed on your PostgreSQL,
the bootstrap skips that one table and prints a warning — everything else
still works. To enable it later:

```sql
CREATE EXTENSION vector;
-- then re-apply the migration, or just create the embeddings table manually
```

Easiest fix: use the **Docker** option above (`pgvector/pgvector:pg16` ships it).

## Migration conventions

- Migrations live in [`backend/src/db/migrations/`](../backend/src/db/migrations/).
- Files are applied in **alphabetical order**: `0000_init.sql`, `0001_*.sql`, …
- **Never edit an applied migration.** To change the schema, add a new file:
  `0001_<short_description>.sql` (number it after the latest one).
- Two ways to apply migrations:
  - **Bootstrap** (creates DB too): `./scripts/setup-local-db.{sh,ps1}`
  - **App runner** (DB already exists): `npm run db:migrate` —
    runs [scripts/migrate.ts](../backend/scripts/migrate.ts), which applies
    every `.sql` in the folder in order.
  - **Drizzle** (if you author schemas in TS): `npm run db:generate` then
    `npm run db:migrate`.

## Connecting the backend

After the DB is up, ensure `backend/.env` has:

```env
DATABASE_URL=postgresql://jobmatch:jobmatch_dev_pwd@localhost:5432/jobmatch_vn
REDIS_URL=redis://localhost:6379
```

Then `npm run dev`.

## Troubleshooting

- **`psql not found`** (Windows): add `C:\Program Files\PostgreSQL\18\bin` to
  PATH, or let the PowerShell script auto-detect it.
- **`password authentication failed`**: the superuser password is the one you
  set when installing PostgreSQL. Pass it via `-SuperPassword` / `PGPASSWORD`.
- **`port 5432 already in use`**: another Postgres is running. Stop it or edit
  the port in the script and `docker-compose.yml`.
