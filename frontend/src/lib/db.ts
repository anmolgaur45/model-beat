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
  max: 3,
  idle_timeout: 20, // release idle conns quickly between invocations
  max_lifetime: 60 * 30, // recycle a connection every ~30 min
  connect_timeout: 10,
})

export default sql
