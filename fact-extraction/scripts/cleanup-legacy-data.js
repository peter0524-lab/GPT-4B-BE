/**
 * 레거시 데이터 정리 스크립트
 * - business_cards에 존재하지 않는 card_id를 참조하는 데이터 삭제
 */

import { query, execute, closePool } from '../lib/db.js';

async function cleanupLegacyData() {
  console.log('=== 레거시 데이터 정리 시작 ===\n');
  
  const userId = 1;
  
  try {
    // 1. 현재 존재하는 business_cards ID 목록 조회
    const validCards = await query(
      `SELECT id, name FROM business_cards WHERE userId = ?`,
      [userId]
    );
    const validCardIds = new Set(validCards.map(c => c.id));
    console.log(`✅ 유효한 명함 ID: [${[...validCardIds].join(', ')}]`);
    console.log(`   총 ${validCardIds.size}개 명함\n`);

    // 2. 문제 있는 memo 찾기 및 삭제
    const badMemos = await query(
      `SELECT id, business_card_id, content 
       FROM memo 
       WHERE user_id = ? AND (business_card_id IS NULL OR business_card_id = 0 OR business_card_id NOT IN (SELECT id FROM business_cards))`,
      [userId]
    );
    console.log(`❌ 문제 있는 memo: ${badMemos.length}개`);
    if (badMemos.length > 0) {
      console.log('   삭제 대상:');
      badMemos.slice(0, 5).forEach(m => {
        console.log(`   - memo id=${m.id}, card_id=${m.business_card_id}, content="${(m.content || '').substring(0, 30)}..."`);
      });
      if (badMemos.length > 5) console.log(`   ... 외 ${badMemos.length - 5}개`);
      
      const result = await execute(
        `DELETE FROM memo WHERE user_id = ? AND (business_card_id IS NULL OR business_card_id = 0 OR business_card_id NOT IN (SELECT id FROM business_cards))`,
        [userId]
      );
      console.log(`   → ${result.affectedRows}개 삭제 완료\n`);
    }

    // 3. 문제 있는 events 찾기 및 수정/삭제
    const allEvents = await query(
      `SELECT id, title, linked_card_ids FROM events WHERE userId = ?`,
      [userId]
    );
    let eventsFixed = 0;
    let eventsDeleted = 0;
    
    for (const event of allEvents) {
      if (!event.linked_card_ids) continue;
      
      const cardIds = event.linked_card_ids.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      const validIds = cardIds.filter(id => validCardIds.has(id));
      
      if (validIds.length === 0) {
        // 모든 linked_card_ids가 유효하지 않음 → 삭제
        await execute(`DELETE FROM events WHERE id = ?`, [event.id]);
        eventsDeleted++;
      } else if (validIds.length < cardIds.length) {
        // 일부만 유효 → 수정
        await execute(
          `UPDATE events SET linked_card_ids = ? WHERE id = ?`,
          [validIds.join(','), event.id]
        );
        eventsFixed++;
      }
    }
    console.log(`❌ 문제 있는 events: 삭제 ${eventsDeleted}개, 수정 ${eventsFixed}개\n`);

    // 4. 문제 있는 gifts 찾기 및 삭제
    const badGifts = await query(
      `SELECT id, cardId, giftName 
       FROM gifts 
       WHERE userId = ? AND (cardId IS NULL OR cardId = 0 OR cardId NOT IN (SELECT id FROM business_cards))`,
      [userId]
    );
    console.log(`❌ 문제 있는 gifts: ${badGifts.length}개`);
    if (badGifts.length > 0) {
      console.log('   삭제 대상:');
      badGifts.slice(0, 5).forEach(g => {
        console.log(`   - gift id=${g.id}, card_id=${g.cardId}, name="${g.giftName}"`);
      });
      if (badGifts.length > 5) console.log(`   ... 외 ${badGifts.length - 5}개`);
      
      const result = await execute(
        `DELETE FROM gifts WHERE userId = ? AND (cardId IS NULL OR cardId = 0 OR cardId NOT IN (SELECT id FROM business_cards))`,
        [userId]
      );
      console.log(`   → ${result.affectedRows}개 삭제 완료\n`);
    }

    // 5. 문제 있는 source_event 찾기 및 삭제
    const badSourceEvents = await query(
      `SELECT id, card_id, source_type, source_pk 
       FROM source_event 
       WHERE user_id = ? AND (card_id IS NULL OR card_id = 0 OR card_id NOT IN (SELECT id FROM business_cards))`,
      [userId]
    );
    console.log(`❌ 문제 있는 source_event: ${badSourceEvents.length}개`);
    if (badSourceEvents.length > 0) {
      const result = await execute(
        `DELETE FROM source_event WHERE user_id = ? AND (card_id IS NULL OR card_id = 0 OR card_id NOT IN (SELECT id FROM business_cards))`,
        [userId]
      );
      console.log(`   → ${result.affectedRows}개 삭제 완료\n`);
    }

    // 6. 문제 있는 extracted_fact 찾기 및 삭제
    const badFacts = await query(
      `SELECT id, card_id, fact_type, fact_key 
       FROM extracted_fact 
       WHERE user_id = ? AND (card_id IS NULL OR card_id = 0 OR card_id NOT IN (SELECT id FROM business_cards))`,
      [userId]
    );
    console.log(`❌ 문제 있는 extracted_fact: ${badFacts.length}개`);
    if (badFacts.length > 0) {
      const result = await execute(
        `DELETE FROM extracted_fact WHERE user_id = ? AND (card_id IS NULL OR card_id = 0 OR card_id NOT IN (SELECT id FROM business_cards))`,
        [userId]
      );
      console.log(`   → ${result.affectedRows}개 삭제 완료\n`);
    }

    // 7. 최종 상태 출력
    console.log('=== 정리 완료 ===\n');
    
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM business_cards WHERE userId = ?) as cards,
        (SELECT COUNT(*) FROM memo WHERE user_id = ?) as memos,
        (SELECT COUNT(*) FROM events WHERE userId = ?) as events,
        (SELECT COUNT(*) FROM gifts WHERE userId = ?) as gifts,
        (SELECT COUNT(*) FROM chats WHERE userId = ?) as chats,
        (SELECT COUNT(*) FROM source_event WHERE user_id = ?) as source_events,
        (SELECT COUNT(*) FROM extracted_fact WHERE user_id = ?) as facts
    `, [userId, userId, userId, userId, userId, userId, userId]);
    
    console.log('📊 현재 데이터 현황:');
    console.log(`   - 명함: ${stats[0].cards}개`);
    console.log(`   - 메모: ${stats[0].memos}개`);
    console.log(`   - 일정: ${stats[0].events}개`);
    console.log(`   - 선물: ${stats[0].gifts}개`);
    console.log(`   - 채팅: ${stats[0].chats}개`);
    console.log(`   - source_event: ${stats[0].source_events}개`);
    console.log(`   - extracted_fact: ${stats[0].facts}개`);

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await closePool();
  }
}

cleanupLegacyData();

