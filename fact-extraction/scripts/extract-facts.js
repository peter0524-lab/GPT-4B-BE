/**
 * LLM Fact 추출 스크립트
 * 
 * source_event에서 미처리된 레코드를 가져와
 * LLM으로 fact를 추출하고 extracted_fact에 저장
 * 
 * 사용법:
 *   node scripts/extract-facts.js [--batch-size <n>] [--watch]
 */

import { query, execute, closePool, getConnection } from "../lib/db.js";
import { extractFacts } from "../lib/llm-client.js";
import { validateFacts, deduplicateFacts } from "../lib/validators/fact-validator.js";
import { config } from "../config.js";

/**
 * 미처리 source_event 가져오기
 */
async function getPendingSourceEvents(limit = 10) {
  return await query(
    `SELECT se.*, bc.name as card_name, bc.company as card_company
     FROM source_event se
     JOIN business_cards bc ON se.card_id = bc.id
     WHERE se.is_processed = FALSE
     ORDER BY se.occurred_at ASC
     LIMIT ?`,
    [limit]
  );
}

/**
 * fact 배열을 DB에 저장
 */
async function saveFacts(connection, sourceEventId, userId, cardId, facts) {
  let insertedCount = 0;

  for (const fact of facts) {
    await connection.query(
      `INSERT INTO extracted_fact 
       (source_event_id, user_id, card_id, fact_type, fact_key, fact_value, confidence, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceEventId,
        userId,
        cardId,
        fact.fact_type,
        fact.fact_key,
        fact.fact_value,
        fact.confidence,
        fact.evidence,
      ]
    );
    insertedCount++;
  }

  return insertedCount;
}

/**
 * source_event 처리 완료 표시
 */
async function markAsProcessed(connection, sourceEventId) {
  await connection.query(
    `UPDATE source_event 
     SET is_processed = TRUE, processed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [sourceEventId]
  );
}

/**
 * 단일 source_event 처리
 */
async function processSourceEvent(connection, sourceEvent) {
  console.log(`\n처리 중: [${sourceEvent.source_type}] ${sourceEvent.card_name || "Unknown"}`);
  console.log(`  raw_text 미리보기: ${sourceEvent.raw_text.substring(0, 100)}...`);

  try {
    // 1. LLM으로 fact 추출
    const rawFacts = await extractFacts(sourceEvent);
    console.log(`  LLM 추출 결과: ${rawFacts.length}개 fact`);

    if (rawFacts.length === 0) {
      // fact가 없어도 처리 완료로 표시
      await markAsProcessed(connection, sourceEvent.id);
      console.log(`  → fact 없음, 처리 완료`);
      return { extracted: 0, saved: 0 };
    }

    // 2. 검증
    const { validFacts, invalidFacts, summary } = validateFacts(rawFacts);
    console.log(`  검증 결과: 유효 ${summary.valid}개, 무효 ${summary.invalid}개`);

    if (invalidFacts.length > 0) {
      for (const invalid of invalidFacts) {
        console.log(`    무효: ${JSON.stringify(invalid.original)} - ${invalid.errors.join(", ")}`);
      }
    }

    // 3. 중복 제거
    const dedupedFacts = deduplicateFacts(validFacts);
    console.log(`  중복 제거 후: ${dedupedFacts.length}개`);

    // 4. DB 저장
    const savedCount = await saveFacts(
      connection,
      sourceEvent.id,
      sourceEvent.user_id,
      sourceEvent.card_id,
      dedupedFacts
    );

    // 5. 처리 완료 표시
    await markAsProcessed(connection, sourceEvent.id);

    console.log(`  → ${savedCount}개 fact 저장 완료`);

    return { extracted: rawFacts.length, saved: savedCount };

  } catch (error) {
    console.error(`  → 오류: ${error.message}`);
    // 오류 발생 시에도 무한 루프 방지를 위해 처리 완료로 표시 (옵션)
    // await markAsProcessed(connection, sourceEvent.id);
    return { extracted: 0, saved: 0, error: error.message };
  }
}

/**
 * 배치 처리
 */
async function processBatch(batchSize = 10) {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const pendingEvents = await getPendingSourceEvents(batchSize);
    
    if (pendingEvents.length === 0) {
      console.log("처리할 source_event가 없습니다.");
      await connection.commit();
      return { processed: 0, totalExtracted: 0, totalSaved: 0 };
    }

    console.log(`\n=== ${pendingEvents.length}개 source_event 처리 시작 ===`);

    let totalExtracted = 0;
    let totalSaved = 0;

    for (const event of pendingEvents) {
      const result = await processSourceEvent(connection, event);
      totalExtracted += result.extracted;
      totalSaved += result.saved;

      // Rate limiting (API 호출 사이에 잠시 대기)
      await new Promise((r) => setTimeout(r, 500));
    }

    await connection.commit();

    console.log(`\n=== 배치 완료 ===`);
    console.log(`  처리: ${pendingEvents.length}개`);
    console.log(`  추출: ${totalExtracted}개`);
    console.log(`  저장: ${totalSaved}개`);

    return { processed: pendingEvents.length, totalExtracted, totalSaved };

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * 통계 출력
 */
async function printStats() {
  // source_event 상태
  const sourceStats = await query(`
    SELECT 
      source_type,
      SUM(CASE WHEN is_processed THEN 1 ELSE 0 END) as processed,
      SUM(CASE WHEN NOT is_processed THEN 1 ELSE 0 END) as pending
    FROM source_event
    GROUP BY source_type
  `);

  console.log("\n=== source_event 처리 현황 ===");
  for (const row of sourceStats) {
    console.log(`  ${row.source_type}: 완료 ${row.processed}, 대기 ${row.pending}`);
  }

  // extracted_fact 현황
  const factStats = await query(`
    SELECT 
      fact_type,
      COUNT(*) as count,
      AVG(confidence) as avg_confidence
    FROM extracted_fact
    GROUP BY fact_type
    ORDER BY count DESC
  `);

  console.log("\n=== extracted_fact 현황 ===");
  console.log("Fact Type       | Count | Avg Confidence");
  console.log("----------------|-------|---------------");
  for (const row of factStats) {
    console.log(
      `${row.fact_type.padEnd(15)} | ${String(row.count).padStart(5)} | ${row.avg_confidence.toFixed(2)}`
    );
  }

  // 총계
  const [total] = await query(`SELECT COUNT(*) as total FROM extracted_fact`);
  console.log(`\n총 fact 수: ${total.total}`);
}

/**
 * 메인 실행
 */
async function main() {
  const args = process.argv.slice(2);

  let batchSize = config.worker.batchSize;
  const batchIndex = args.indexOf("--batch-size");
  if (batchIndex !== -1 && args[batchIndex + 1]) {
    batchSize = parseInt(args[batchIndex + 1]);
  }

  const watchMode = args.includes("--watch");

  console.log("=== Fact 추출 시작 ===");
  console.log(`배치 크기: ${batchSize}`);

  try {
    if (watchMode) {
      console.log("Watch 모드 활성화 (5초마다 폴링)");
      console.log("종료하려면 Ctrl+C\n");

      while (true) {
        const result = await processBatch(batchSize);
        
        if (result.processed === 0) {
          console.log("대기 중...");
        }
        
        await printStats();
        await new Promise((r) => setTimeout(r, config.worker.pollIntervalMs));
      }
    } else {
      // 모든 pending 처리할 때까지 반복
      let hasMore = true;
      while (hasMore) {
        const result = await processBatch(batchSize);
        hasMore = result.processed > 0;
      }
      
      await printStats();
    }

  } catch (error) {
    console.error("\n오류 발생:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (!watchMode) {
      await closePool();
    }
  }
}

main();

