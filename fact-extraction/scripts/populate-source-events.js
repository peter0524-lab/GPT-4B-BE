/**
 * source_event 자동 생성 워커
 * 
 * 원본 테이블(business_cards, memo, events, gifts, chats)을 스캔하여
 * source_event 테이블을 자동으로 채움
 * 
 * 사용법:
 *   node scripts/populate-source-events.js [--user-id <id>] [--watch]
 */

import { query, execute, closePool, getConnection } from "../lib/db.js";
import { parseLinkedCardIds } from "../lib/parsers/event-parser.js";
import { inferCardIdsFromChat } from "../lib/parsers/chat-parser.js";
import { buildRawText } from "../lib/parsers/source-text-builder.js";
import { config } from "../config.js";

/**
 * 이미 처리된 source_event 확인
 */
async function getExistingSourceEvents(sourceType) {
  const rows = await query(
    `SELECT source_pk, card_id FROM source_event WHERE source_type = ?`,
    [sourceType]
  );
  
  // Set으로 변환 (빠른 조회용)
  const existingSet = new Set();
  for (const row of rows) {
    existingSet.add(`${row.source_pk}:${row.card_id}`);
  }
  return existingSet;
}

/**
 * source_event INSERT
 */
async function insertSourceEvent(connection, data) {
  await connection.query(
    `INSERT INTO source_event 
     (user_id, card_id, source_type, source_pk, occurred_at, raw_text)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE raw_text = VALUES(raw_text), updated_at = CURRENT_TIMESTAMP`,
    [
      data.userId,
      data.cardId,
      data.sourceType,
      data.sourcePk,
      data.occurredAt,
      data.rawText,
    ]
  );
}

/**
 * CARD: business_cards 처리
 */
async function processCards(connection, userId = null) {
  console.log("\n[CARD] 명함 처리 시작...");

  const existing = await getExistingSourceEvents("CARD");
  
  let whereClause = "1=1";
  const params = [];
  if (userId) {
    whereClause = "userId = ?";
    params.push(userId);
  }

  const cards = await query(
    `SELECT * FROM business_cards WHERE ${whereClause}`,
    params
  );

  let inserted = 0;
  for (const card of cards) {
    const key = `${card.id}:${card.id}`;
    if (existing.has(key)) continue;

    const rawText = buildRawText("CARD", card);
    
    await insertSourceEvent(connection, {
      userId: card.userId,
      cardId: card.id,
      sourceType: "CARD",
      sourcePk: card.id,
      occurredAt: card.createdAt,
      rawText,
    });
    inserted++;
  }

  console.log(`  처리: ${cards.length}개, 신규 삽입: ${inserted}개`);
  return inserted;
}

/**
 * MEMO: memo 처리
 */
async function processMemos(connection, userId = null) {
  console.log("\n[MEMO] 메모 처리 시작...");

  const existing = await getExistingSourceEvents("MEMO");

  let whereClause = "1=1";
  const params = [];
  if (userId) {
    whereClause = "m.user_id = ?";
    params.push(userId);
  }

  const memos = await query(
    `SELECT m.*, bc.name, bc.company, bc.position
     FROM memo m
     LEFT JOIN business_cards bc ON m.business_card_id = bc.id
     WHERE ${whereClause}`,
    params
  );

  let inserted = 0;
  for (const memo of memos) {
    const key = `${memo.id}:${memo.business_card_id}`;
    if (existing.has(key)) continue;

    const card = {
      name: memo.name,
      company: memo.company,
      position: memo.position,
    };
    const rawText = buildRawText("MEMO", memo, card);

    await insertSourceEvent(connection, {
      userId: memo.user_id,
      cardId: memo.business_card_id,
      sourceType: "MEMO",
      sourcePk: memo.id,
      occurredAt: memo.created_at || memo.updated_at,
      rawText,
    });
    inserted++;
  }

  console.log(`  처리: ${memos.length}개, 신규 삽입: ${inserted}개`);
  return inserted;
}

/**
 * EVENT: events 처리
 * event 1개가 여러 card와 연결될 수 있음 → 여러 source_event 생성
 */
async function processEvents(connection, userId = null) {
  console.log("\n[EVENT] 일정 처리 시작...");

  const existing = await getExistingSourceEvents("EVENT");

  let whereClause = "1=1";
  const params = [];
  if (userId) {
    whereClause = "userId = ?";
    params.push(userId);
  }

  const events = await query(
    `SELECT * FROM events WHERE ${whereClause}`,
    params
  );

  // 명함 정보 미리 로드
  const cards = await query(`SELECT * FROM business_cards`);
  const cardMap = new Map(cards.map((c) => [c.id, c]));

  let inserted = 0;
  for (const event of events) {
    const cardIds = parseLinkedCardIds(event.linked_card_ids);

    // 연결된 명함이 없으면 스킵
    if (cardIds.length === 0) continue;

    for (const cardId of cardIds) {
      const key = `${event.id}:${cardId}`;
      if (existing.has(key)) continue;

      const card = cardMap.get(cardId);
      const rawText = buildRawText("EVENT", event, card);

      await insertSourceEvent(connection, {
        userId: event.userId,
        cardId: cardId,
        sourceType: "EVENT",
        sourcePk: event.id,
        occurredAt: event.startDate,
        rawText,
      });
      inserted++;
    }
  }

  console.log(`  처리: ${events.length}개, 신규 삽입: ${inserted}개`);
  return inserted;
}

/**
 * GIFT: gifts 처리
 */
async function processGifts(connection, userId = null) {
  console.log("\n[GIFT] 선물 처리 시작...");

  const existing = await getExistingSourceEvents("GIFT");

  let whereClause = "1=1";
  const params = [];
  if (userId) {
    whereClause = "g.userId = ?";
    params.push(userId);
  }

  const gifts = await query(
    `SELECT g.*, bc.name, bc.company, bc.position
     FROM gifts g
     LEFT JOIN business_cards bc ON g.cardId = bc.id
     WHERE ${whereClause}`,
    params
  );

  let inserted = 0;
  for (const gift of gifts) {
    const key = `${gift.id}:${gift.cardId}`;
    if (existing.has(key)) continue;

    const card = {
      name: gift.name,
      company: gift.company,
      position: gift.position,
    };
    const rawText = buildRawText("GIFT", gift, card);

    await insertSourceEvent(connection, {
      userId: gift.userId,
      cardId: gift.cardId,
      sourceType: "GIFT",
      sourcePk: gift.id,
      occurredAt: gift.purchaseDate || gift.createdAt,
      rawText,
    });
    inserted++;
  }

  console.log(`  처리: ${gifts.length}개, 신규 삽입: ${inserted}개`);
  return inserted;
}

/**
 * CHAT: chats 처리
 * chats에는 직접적인 cardId가 없으므로, messages 내용에서 추론 필요
 */
async function processChats(connection, userId = null) {
  console.log("\n[CHAT] 채팅 처리 시작...");

  const existing = await getExistingSourceEvents("CHAT");

  let whereClause = "1=1";
  const params = [];
  if (userId) {
    whereClause = "userId = ?";
    params.push(userId);
  }

  const chats = await query(
    `SELECT * FROM chats WHERE ${whereClause} AND isActive = TRUE`,
    params
  );

  // 사용자별 명함 목록 로드
  const userCards = new Map();
  const allCards = await query(`SELECT * FROM business_cards`);
  for (const card of allCards) {
    if (!userCards.has(card.userId)) {
      userCards.set(card.userId, []);
    }
    userCards.get(card.userId).push(card);
  }

  let inserted = 0;
  for (const chat of chats) {
    const userCardList = userCards.get(chat.userId) || [];
    const inferredCardIds = inferCardIdsFromChat(chat, userCardList);

    // 추론된 카드가 없으면, 첫 번째 카드 사용 (fallback)
    const cardIds = inferredCardIds.length > 0 
      ? inferredCardIds 
      : userCardList.length > 0 
        ? [userCardList[0].id] 
        : [];

    for (const cardId of cardIds) {
      const key = `${chat.id}:${cardId}`;
      if (existing.has(key)) continue;

      const card = allCards.find((c) => c.id === cardId);
      const rawText = buildRawText("CHAT", chat, card);

      await insertSourceEvent(connection, {
        userId: chat.userId,
        cardId: cardId,
        sourceType: "CHAT",
        sourcePk: chat.id,
        occurredAt: chat.createdAt,
        rawText,
      });
      inserted++;
    }
  }

  console.log(`  처리: ${chats.length}개, 신규 삽입: ${inserted}개`);
  return inserted;
}

/**
 * 전체 처리
 */
async function populateAll(userId = null) {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const results = {
      cards: await processCards(connection, userId),
      memos: await processMemos(connection, userId),
      events: await processEvents(connection, userId),
      gifts: await processGifts(connection, userId),
      chats: await processChats(connection, userId),
    };

    await connection.commit();

    const total = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(`\n=== 총 ${total}개의 source_event 생성 완료 ===`);

    return results;

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
  const stats = await query(`
    SELECT 
      source_type,
      COUNT(*) as count,
      SUM(CASE WHEN is_processed THEN 1 ELSE 0 END) as processed,
      SUM(CASE WHEN NOT is_processed THEN 1 ELSE 0 END) as pending
    FROM source_event
    GROUP BY source_type
    ORDER BY source_type
  `);

  console.log("\n=== source_event 통계 ===");
  console.log("Source Type  | Total | Processed | Pending");
  console.log("-------------|-------|-----------|--------");
  
  for (const row of stats) {
    console.log(
      `${row.source_type.padEnd(12)} | ${String(row.count).padStart(5)} | ${String(row.processed).padStart(9)} | ${String(row.pending).padStart(6)}`
    );
  }
}

/**
 * 메인 실행
 */
async function main() {
  const args = process.argv.slice(2);

  let userId = null;
  const userIdIndex = args.indexOf("--user-id");
  if (userIdIndex !== -1 && args[userIdIndex + 1]) {
    userId = parseInt(args[userIdIndex + 1]);
  }

  const watchMode = args.includes("--watch");

  console.log("=== source_event 생성 시작 ===");
  if (userId) {
    console.log(`대상 User ID: ${userId}`);
  }

  try {
    if (watchMode) {
      console.log("Watch 모드 활성화 (5초마다 폴링)");
      console.log("종료하려면 Ctrl+C\n");

      while (true) {
        await populateAll(userId);
        await printStats();
        await new Promise((r) => setTimeout(r, config.worker.pollIntervalMs));
      }
    } else {
      await populateAll(userId);
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

