/**
 * 마이그레이션 실행 스크립트
 * source_event, extracted_fact 테이블 생성 + 스키마 변경
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getConnection, closePool } from "../lib/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  let connection;

  try {
    console.log("=== 마이그레이션 시작 ===\n");

    // 마이그레이션 파일 목록 (순서대로 실행)
    const migrationFiles = [
      "001_create_source_extracted_tables.sql",
      "002_change_fact_value_to_polarity.sql"
    ];
    
    // DB 연결
    connection = await getConnection();
    console.log("DB 연결 성공\n");
    
    for (const fileName of migrationFiles) {
      const sqlPath = path.join(__dirname, "..", "migrations", fileName);
      
      // 파일이 없으면 스킵
      if (!fs.existsSync(sqlPath)) {
        console.log(`스킵: ${fileName} (파일 없음)`);
        continue;
      }
      
      const sql = fs.readFileSync(sqlPath, "utf8");
      console.log(`\n--- ${fileName} 실행 ---`);

      // SQL 실행 (문장 단위로 분리)
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        
        // 주석 제거 후 확인
        const cleanStmt = stmt
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim();

        if (!cleanStmt) continue;

        try {
          await connection.query(cleanStmt);
          
          // 테이블/뷰/인덱스 이름 추출하여 로그
          const createMatch = cleanStmt.match(
            /CREATE\s+(?:TABLE|VIEW|INDEX|OR\s+REPLACE\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i
          );
          const alterMatch = cleanStmt.match(/ALTER\s+TABLE\s+(\w+)/i);
          
          if (createMatch) {
            console.log(`✓ ${createMatch[1]} 생성/변경 완료`);
          } else if (alterMatch) {
            console.log(`✓ ${alterMatch[1]} ALTER 완료`);
          }
        } catch (error) {
          // 이미 존재하는 경우 또는 컬럼이 없는 경우 무시
          if (error.code === "ER_TABLE_EXISTS_ERROR" || 
              error.code === "ER_DUP_KEYNAME" ||
              error.code === "ER_DUP_FIELDNAME" ||
              error.code === "ER_CANT_DROP_FIELD_OR_KEY") {
            console.log(`⊘ 이미 존재하거나 적용됨 (무시): ${error.message.substring(0, 50)}`);
          } else {
            console.error(`⚠ 오류 (계속 진행): ${error.message}`);
          }
        }
      }
    }

    console.log("\n=== 마이그레이션 완료 ===");

    // 생성된 테이블 확인
    const [tables] = await connection.query(`
      SELECT TABLE_NAME 
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = 'HCI_2025'
      AND TABLE_NAME IN ('source_event', 'extracted_fact', 'fact_dictionary')
      ORDER BY TABLE_NAME
    `);

    console.log("\n생성된 테이블:");
    for (const table of tables) {
      console.log(`  - ${table.TABLE_NAME}`);
    }

    // extracted_fact 컬럼 확인
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = 'HCI_2025'
      AND TABLE_NAME = 'extracted_fact'
      ORDER BY ORDINAL_POSITION
    `);

    console.log("\nextracted_fact 컬럼:");
    for (const col of columns) {
      console.log(`  - ${col.COLUMN_NAME} (${col.DATA_TYPE}) ${col.COLUMN_COMMENT || ''}`);
    }

  } catch (error) {
    console.error("\n오류 발생:", error.message);
    if (error.sql) {
      console.error("문제 SQL:", error.sql.substring(0, 200));
    }
    process.exit(1);
  } finally {
    if (connection) {
      connection.release();
    }
    await closePool();
  }
}

runMigration();
