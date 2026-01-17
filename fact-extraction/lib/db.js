/**
 * 데이터베이스 연결 모듈
 */
import mysql from "mysql2/promise";
import { config } from "../config.js";

let pool = null;

export const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true,
      dateStrings: true,
    });
  }
  return pool;
};

export const getConnection = async () => {
  const pool = getPool();
  return await pool.getConnection();
};

export const query = async (sql, params = []) => {
  const pool = getPool();
  const [rows] = await pool.query(sql, params);
  return rows;
};

export const execute = async (sql, params = []) => {
  const pool = getPool();
  const [result] = await pool.execute(sql, params);
  return result;
};

export const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

export default { getPool, getConnection, query, execute, closePool };

