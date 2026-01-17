import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function checkSchema() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
    });

    console.log("=== HCI_2025 스키마 데이터베이스 구조 ===\n");

    // 1. 모든 테이블 목록 조회
    const [tables] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = 'HCI_2025'
      ORDER BY TABLE_NAME
    `);

    console.log(`총 ${tables.length}개의 테이블이 있습니다:\n`);
    for (const table of tables) {
      console.log(`- ${table.TABLE_NAME}`);
    }
    console.log("\n");

    // 2. 각 테이블의 상세 구조 조회
    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      console.log(`\n${"=".repeat(80)}`);
      console.log(`테이블: ${tableName}`);
      console.log("=".repeat(80));

      // 컬럼 정보
      const [columns] = await connection.query(
        `
        SELECT 
          COLUMN_NAME,
          COLUMN_TYPE,
          IS_NULLABLE,
          COLUMN_DEFAULT,
          COLUMN_KEY,
          EXTRA,
          COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = 'HCI_2025' AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `,
        [tableName]
      );

      console.log("\n[컬럼 정보]");
      console.log("-".repeat(80));
      for (const col of columns) {
        const keyInfo = col.COLUMN_KEY ? ` [${col.COLUMN_KEY}]` : "";
        const defaultInfo =
          col.COLUMN_DEFAULT !== null ? ` DEFAULT ${col.COLUMN_DEFAULT}` : "";
        const extraInfo = col.EXTRA ? ` ${col.EXTRA}` : "";
        const nullable = col.IS_NULLABLE === "YES" ? "NULL" : "NOT NULL";
        console.log(
          `  ${col.COLUMN_NAME.padEnd(30)} ${col.COLUMN_TYPE.padEnd(
            25
          )} ${nullable.padEnd(10)}${keyInfo}${defaultInfo}${extraInfo}`
        );
        if (col.COLUMN_COMMENT) {
          console.log(`    └─ Comment: ${col.COLUMN_COMMENT}`);
        }
      }

      // 인덱스 정보
      const [indexes] = await connection.query(
        `
        SELECT 
          INDEX_NAME,
          COLUMN_NAME,
          NON_UNIQUE,
          SEQ_IN_INDEX
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = 'HCI_2025' AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `,
        [tableName]
      );

      if (indexes.length > 0) {
        console.log("\n[인덱스 정보]");
        console.log("-".repeat(80));
        const indexMap = {};
        for (const idx of indexes) {
          if (!indexMap[idx.INDEX_NAME]) {
            indexMap[idx.INDEX_NAME] = {
              unique: idx.NON_UNIQUE === 0,
              columns: [],
            };
          }
          indexMap[idx.INDEX_NAME].columns.push(idx.COLUMN_NAME);
        }
        for (const [idxName, idxInfo] of Object.entries(indexMap)) {
          const uniqueStr = idxInfo.unique ? "UNIQUE" : "";
          console.log(
            `  ${idxName.padEnd(30)} ${uniqueStr} (${idxInfo.columns.join(
              ", "
            )})`
          );
        }
      }

      // 외래 키 정보
      const [foreignKeys] = await connection.query(
        `
        SELECT 
          kcu.CONSTRAINT_NAME,
          kcu.COLUMN_NAME,
          kcu.REFERENCED_TABLE_NAME,
          kcu.REFERENCED_COLUMN_NAME,
          rc.UPDATE_RULE,
          rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
          ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
          AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = 'HCI_2025' 
          AND kcu.TABLE_NAME = ?
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.CONSTRAINT_NAME
      `,
        [tableName]
      );

      if (foreignKeys.length > 0) {
        console.log("\n[외래 키 정보]");
        console.log("-".repeat(80));
        const fkMap = {};
        for (const fk of foreignKeys) {
          if (!fkMap[fk.CONSTRAINT_NAME]) {
            fkMap[fk.CONSTRAINT_NAME] = {
              columns: [],
              referenced: fk.REFERENCED_TABLE_NAME,
              refColumns: [],
              updateRule: fk.UPDATE_RULE,
              deleteRule: fk.DELETE_RULE,
            };
          }
          fkMap[fk.CONSTRAINT_NAME].columns.push(fk.COLUMN_NAME);
          fkMap[fk.CONSTRAINT_NAME].refColumns.push(fk.REFERENCED_COLUMN_NAME);
        }
        for (const [fkName, fkInfo] of Object.entries(fkMap)) {
          console.log(`  ${fkName}:`);
          console.log(
            `    ${fkInfo.columns.join(", ")} → ${
              fkInfo.referenced
            }.${fkInfo.refColumns.join(", ")}`
          );
          console.log(
            `    ON UPDATE ${fkInfo.updateRule}, ON DELETE ${fkInfo.deleteRule}`
          );
        }
      }

      // 테이블 통계
      const [stats] = await connection.query(
        `
        SELECT 
          TABLE_ROWS,
          DATA_LENGTH,
          INDEX_LENGTH,
          ENGINE,
          TABLE_COLLATION
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = 'HCI_2025' AND TABLE_NAME = ?
      `,
        [tableName]
      );

      if (stats[0]) {
        console.log("\n[테이블 통계]");
        console.log("-".repeat(80));
        const stat = stats[0];
        const dataSize = (stat.DATA_LENGTH / 1024 / 1024).toFixed(2);
        const indexSize = (stat.INDEX_LENGTH / 1024 / 1024).toFixed(2);
        console.log(`  행 수: ${stat.TABLE_ROWS.toLocaleString()}`);
        console.log(`  데이터 크기: ${dataSize} MB`);
        console.log(`  인덱스 크기: ${indexSize} MB`);
        console.log(`  엔진: ${stat.ENGINE}`);
        console.log(`  콜레이션: ${stat.TABLE_COLLATION}`);
      }
    }

    console.log(`\n${"=".repeat(80)}\n`);
    console.log("스키마 조회 완료!");
  } catch (error) {
    console.error("오류 발생:", error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

checkSchema();
