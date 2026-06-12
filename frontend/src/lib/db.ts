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
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
})

export default sql
