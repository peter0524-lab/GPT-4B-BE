/**
 * Database Connection Pool
 */
import mysql from "mysql2/promise";
import config from "../config.js";

let pool = null;

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      port: config.db.port,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }
  return pool;
}

export async function query(sql, params = []) {
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function getConnection() {
  const pool = getPool();
  return pool.getConnection();
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}


