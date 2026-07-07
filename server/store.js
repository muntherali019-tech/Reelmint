// Persistence for Reelmint with two interchangeable backends, same async API:
//   • Postgres  — used when DATABASE_URL is set (durable, multi-instance).
//   • JSON file — fallback for local dev / demo (no DB required).
//
// User records are stored as JSONB so the user shape can evolve freely;
// `id`, `email`, and `stripe_customer` are pulled out as columns for lookup.

import fs from "node:fs";
import path from "node:path";

const DATABASE_URL = process.env.DATABASE_URL || "";
export const backend = DATABASE_URL ? "postgres" : "file";

let impl;

// ---------------- Postgres backend ----------------
async function makePostgres() {
  const { default: pg } = await import("pg");
  const needsSSL =
    process.env.PGSSL !== "disable" &&
    !/localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: needsSSL ? { rejectUnauthorized: false } : false,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      stripe_customer TEXT,
      data JSONB NOT NULL
    );
  `);

  const one = async (sql, args) => (await pool.query(sql, args)).rows[0]?.data || null;

  return {
    getUser: (email) =>
      one(`SELECT data FROM users WHERE email = $1`, [String(email).toLowerCase()]),
    getUserById: (id) => one(`SELECT data FROM users WHERE id = $1`, [id]),
    getUserByStripeCustomer: (c) =>
      c ? one(`SELECT data FROM users WHERE stripe_customer = $1`, [c]) : Promise.resolve(null),
    saveUser: async (user) => {
      await pool.query(
        `INSERT INTO users (id, email, stripe_customer, data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email,
               stripe_customer = EXCLUDED.stripe_customer,
               data = EXCLUDED.data`,
        [user.id, user.email.toLowerCase(), user.stripeCustomer || null, user]
      );
      return user;
    },
  };
}

// ---------------- JSON-file backend ----------------
function makeFile() {
  const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
  const FILE = path.join(DATA_DIR, "reelmint.json");
  let db = { users: {} };
  let timer = null;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    console.warn("store(file): load failed, starting empty —", e.message);
  }
  if (!db.users) db.users = {};

  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
      } catch (e) {
        console.warn("store(file): write failed —", e.message);
      }
    }, 150);
  };

  return {
    getUser: async (email) => db.users[String(email).toLowerCase()] || null,
    getUserById: async (id) => Object.values(db.users).find((u) => u.id === id) || null,
    getUserByStripeCustomer: async (c) =>
      c ? Object.values(db.users).find((u) => u.stripeCustomer === c) || null : null,
    saveUser: async (user) => {
      db.users[user.email.toLowerCase()] = user;
      persist();
      return user;
    },
  };
}

// ---------------- public async API ----------------
export async function initStore() {
  impl = backend === "postgres" ? await makePostgres() : makeFile();
  console.log(`store: using ${backend} backend`);
}

export const getUser = (email) => impl.getUser(email);
export const getUserById = (id) => impl.getUserById(id);
export const getUserByStripeCustomer = (c) => impl.getUserByStripeCustomer(c);
export const saveUser = (user) => impl.saveUser(user);
