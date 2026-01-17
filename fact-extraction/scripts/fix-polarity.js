/**
 * extracted_fact 테이블에 polarity 컬럼 추가, fact_value 삭제
 */
import { getConnection, closePool } from "../lib/db.js";

async function fixPolarity() {
  const conn = await getConnection();
  
  try {
    console.log("=== extracted_fact 스키마 수정 ===\n");
    
    // 1. polarity 컬럼 추가
    try {
      await conn.query(`
        ALTER TABLE extracted_fact 
        ADD COLUMN polarity TINYINT NOT NULL DEFAULT 0 
        COMMENT '-1: 부정, 0: 중립, +1: 긍정'
        AFTER fact_key
      `);
      console.log("✓ polarity 컬럼 추가 완료");
    } catch (e) {
      if (e.code === "ER_DUP_FIELDNAME") {
        console.log("⊘ polarity 컬럼 이미 존재");
      } else {
        console.log("polarity 추가 오류:", e.message);
      }
    }

    // 2. fact_value 컬럼 삭제
    try {
      await conn.query("ALTER TABLE extracted_fact DROP COLUMN fact_value");
      console.log("✓ fact_value 컬럼 삭제 완료");
    } catch (e) {
      if (e.code === "ER_CANT_DROP_FIELD_OR_KEY") {
        console.log("⊘ fact_value 컬럼 이미 없음");
      } else {
        console.log("fact_value 삭제 오류:", e.message);
      }
    }

    // 3. polarity 인덱스 추가
    try {
      await conn.query("CREATE INDEX idx_polarity ON extracted_fact(polarity)");
      console.log("✓ idx_polarity 인덱스 추가");
    } catch (e) {
      if (e.code === "ER_DUP_KEYNAME") {
        console.log("⊘ idx_polarity 이미 존재");
      }
    }

    // 4. 복합 인덱스 추가
    try {
      await conn.query("CREATE INDEX idx_fact_type_polarity ON extracted_fact(fact_type, polarity)");
      console.log("✓ idx_fact_type_polarity 인덱스 추가");
    } catch (e) {
      if (e.code === "ER_DUP_KEYNAME") {
        console.log("⊘ idx_fact_type_polarity 이미 존재");
      }
    }

    // 5. 최종 컬럼 확인
    const [cols] = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = 'HCI_2025' AND TABLE_NAME = 'extracted_fact'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log("\n📋 extracted_fact 최종 컬럼:");
    for (const c of cols) {
      console.log(`  - ${c.COLUMN_NAME} (${c.DATA_TYPE}) ${c.COLUMN_COMMENT || ""}`);
    }

    console.log("\n=== 완료 ===");
    
  } finally {
    conn.release();
    await closePool();
  }
}

fixPolarity();

