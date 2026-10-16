import postgres from 'postgres'

const sql = postgres({
  host: process.env.DATABASE_HOST!,
  port: parseInt(process.env.DATABASE_PORT ?? '5432'),
  database: process.env.DATABASE_NAME!,
  username: process.env.DATABASE_USER!,
  password: process.env.DATABASE_PASSWORD!,
  // rejectUnauthorized: true requires DATABASE_SSL_CA (Cloud SQL uses a non-public CA).
  // Without the cert, keep SSL enabled but skip verification — still encrypts the wire.
  ssl: process.env.DATABASE_SSL_CA
    ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true }
    : { rejectUnauthorized: false },
  // Serverless pool sizing. Cloud SQL (db-f1-micro) allows 50 connections
  // (47 usable after superuser reserve). Vercel fans out to many function
  // instances, each with its OWN pool, so total connections ≈ max × busy
  // instances — that product must stay under ~47 or Postgres refuses new
  // connections. A Vercel function serves one request at a time and a single
  // request issues at most ~3 parallel queries, so a small pool is plenty.
  // Dropped 5 → 3 on 2026-07-11: a crawler burst on the dynamic story pages
  // fanned out enough instances to exhaust the slots and the pipeline's
  // connect was refused mid-spike (~14 concurrent instances now fit).
  // A build prerenders with one process per CPU (7 on a dev machine), each with
  // its own pool, and shares the 40-connection ainews_app cap with live traffic.
  // Measured 2026-10-16: warm Vercel instances held 18, and a local build at 2
  // per process peaked the role at 35, so builds get 1.
  max: process.env.NEXT_PHASE === 'phase-production-build' ? 1 : 3,
  idle_timeout: 20, // release idle conns quickly between invocations
  max_lifetime: 60 * 30, // recycle a connection every ~30 min
  connect_timeout: 10,
})

export default sql
