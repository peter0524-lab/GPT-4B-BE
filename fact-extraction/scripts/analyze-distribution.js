/**
 * 데이터 분포 분석 스크립트
 * 
 * 합성 데이터의 품질을 검증하기 위해:
 * 1. memo.content 분포/다양성/중복률 체크
 * 2. chats.messages (UserPrompt) 분포 체크
 * 3. extracted_fact 분포 체크
 * 
 * 사용법:
 *   node scripts/analyze-distribution.js [--output report.json]
 */

import { query, closePool } from "../lib/db.js";
import { parseChatMessages } from "../lib/parsers/chat-parser.js";
import fs from "fs";

/**
 * 텍스트 유사도 계산 (Jaccard)
 */
function jaccardSimilarity(text1, text2) {
  const set1 = new Set(text1.toLowerCase().split(/\s+/));
  const set2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * 중복률 계산
 */
function calculateDuplicateRate(texts, threshold = 0.8) {
  if (texts.length < 2) return { rate: 0, pairs: [] };

  const duplicatePairs = [];
  let duplicateCount = 0;

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const similarity = jaccardSimilarity(texts[i], texts[j]);
      if (similarity >= threshold) {
        duplicateCount++;
        duplicatePairs.push({
          index1: i,
          index2: j,
          similarity: similarity.toFixed(2),
          preview1: texts[i].substring(0, 50),
          preview2: texts[j].substring(0, 50),
        });
      }
    }
  }

  const totalPairs = (texts.length * (texts.length - 1)) / 2;
  const rate = duplicateCount / totalPairs;

  return { rate, pairs: duplicatePairs };
}

/**
 * 텍스트 길이 통계
 */
function calculateLengthStats(texts) {
  if (texts.length === 0) return null;

  const lengths = texts.map((t) => t.length);
  lengths.sort((a, b) => a - b);

  return {
    count: lengths.length,
    min: lengths[0],
    max: lengths[lengths.length - 1],
    avg: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    median: lengths[Math.floor(lengths.length / 2)],
    p25: lengths[Math.floor(lengths.length * 0.25)],
    p75: lengths[Math.floor(lengths.length * 0.75)],
  };
}

/**
 * 단어 빈도 분석
 */
function analyzeWordFrequency(texts, topN = 20) {
  const wordCount = {};

  for (const text of texts) {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1);

    for (const word of words) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
  }

  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

/**
 * memo.content 분석
 */
async function analyzeMemos() {
  console.log("\n=== 메모 (memo.content) 분석 ===\n");

  const memos = await query(`SELECT id, content, business_card_id FROM memo`);
  const contents = memos.map((m) => m.content);

  // 길이 통계
  const lengthStats = calculateLengthStats(contents);
  console.log("길이 통계:", lengthStats);

  // 중복률
  const duplicates = calculateDuplicateRate(contents);
  console.log(`중복률 (80% 유사도 기준): ${(duplicates.rate * 100).toFixed(2)}%`);
  if (duplicates.pairs.length > 0 && duplicates.pairs.length <= 5) {
    console.log("중복 쌍 예시:", duplicates.pairs.slice(0, 3));
  }

  // 단어 빈도
  const wordFreq = analyzeWordFrequency(contents);
  console.log("상위 단어:", wordFreq.slice(0, 10));

  // 명함별 메모 수
  const cardMemoCount = {};
  for (const memo of memos) {
    cardMemoCount[memo.business_card_id] = (cardMemoCount[memo.business_card_id] || 0) + 1;
  }
  console.log("명함별 메모 수:", cardMemoCount);

  return {
    type: "memo",
    count: memos.length,
    lengthStats,
    duplicateRate: duplicates.rate,
    duplicatePairs: duplicates.pairs.slice(0, 5),
    topWords: wordFreq,
    cardDistribution: cardMemoCount,
  };
}

/**
 * chats.messages (UserPrompt) 분석
 */
async function analyzeChats() {
  console.log("\n=== 채팅 (UserPrompt) 분석 ===\n");

  const chats = await query(`SELECT id, messages, title FROM chats WHERE isActive = TRUE`);
  
  const userPrompts = [];
  const additionalInfos = [];
  const selectedGifts = [];

  for (const chat of chats) {
    const parsed = parseChatMessages(chat.messages);
    
    if (parsed.userPrompt) {
      userPrompts.push(parsed.userPrompt);
    }
    if (parsed.additional) {
      additionalInfos.push(parsed.additional);
    }
    if (parsed.selectedGift) {
      selectedGifts.push(parsed.selectedGift);
    }
  }

  console.log(`총 채팅: ${chats.length}개`);
  console.log(`UserPrompt 추출: ${userPrompts.length}개`);
  console.log(`추가 정보 추출: ${additionalInfos.length}개`);
  console.log(`선택한 선물 추출: ${selectedGifts.length}개`);

  // UserPrompt 분석
  if (userPrompts.length > 0) {
    const lengthStats = calculateLengthStats(userPrompts);
    console.log("\nUserPrompt 길이 통계:", lengthStats);

    const duplicates = calculateDuplicateRate(userPrompts);
    console.log(`UserPrompt 중복률: ${(duplicates.rate * 100).toFixed(2)}%`);
  }

  // 추가 정보 빈도
  const additionalFreq = {};
  for (const info of additionalInfos) {
    additionalFreq[info] = (additionalFreq[info] || 0) + 1;
  }
  console.log("\n추가 정보 분포:", additionalFreq);

  return {
    type: "chat",
    totalChats: chats.length,
    userPromptCount: userPrompts.length,
    additionalInfoCount: additionalInfos.length,
    selectedGiftCount: selectedGifts.length,
    additionalInfoDistribution: additionalFreq,
  };
}

/**
 * extracted_fact 분석
 */
async function analyzeFacts() {
  console.log("\n=== Extracted Fact 분석 ===\n");

  const facts = await query(`
    SELECT ef.*, bc.name as card_name
    FROM extracted_fact ef
    JOIN business_cards bc ON ef.card_id = bc.id
  `);

  if (facts.length === 0) {
    console.log("추출된 fact가 없습니다.");
    return { type: "fact", count: 0 };
  }

  // fact_type 분포
  const typeDistribution = {};
  for (const fact of facts) {
    typeDistribution[fact.fact_type] = (typeDistribution[fact.fact_type] || 0) + 1;
  }
  console.log("fact_type 분포:", typeDistribution);

  // fact_key 빈도
  const keyFrequency = {};
  for (const fact of facts) {
    const key = fact.fact_key.toLowerCase();
    keyFrequency[key] = (keyFrequency[key] || 0) + 1;
  }
  const topKeys = Object.entries(keyFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  console.log("상위 fact_key:", topKeys);

  // confidence 분포
  const confidences = facts.map((f) => f.confidence);
  console.log("confidence 통계:", {
    min: Math.min(...confidences).toFixed(2),
    max: Math.max(...confidences).toFixed(2),
    avg: (confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2),
  });

  // 명함별 fact 수
  const cardFactCount = {};
  for (const fact of facts) {
    const key = fact.card_name || fact.card_id;
    cardFactCount[key] = (cardFactCount[key] || 0) + 1;
  }
  console.log("명함별 fact 수:", cardFactCount);

  return {
    type: "fact",
    count: facts.length,
    typeDistribution,
    topKeys,
    confidenceStats: {
      min: Math.min(...confidences),
      max: Math.max(...confidences),
      avg: confidences.reduce((a, b) => a + b, 0) / confidences.length,
    },
    cardDistribution: cardFactCount,
  };
}

/**
 * source_event 분석
 */
async function analyzeSourceEvents() {
  console.log("\n=== Source Event 분석 ===\n");

  const events = await query(`
    SELECT source_type, is_processed, COUNT(*) as count
    FROM source_event
    GROUP BY source_type, is_processed
  `);

  const distribution = {};
  for (const row of events) {
    if (!distribution[row.source_type]) {
      distribution[row.source_type] = { processed: 0, pending: 0 };
    }
    if (row.is_processed) {
      distribution[row.source_type].processed = row.count;
    } else {
      distribution[row.source_type].pending = row.count;
    }
  }

  console.log("source_type 분포:");
  for (const [type, counts] of Object.entries(distribution)) {
    console.log(`  ${type}: 처리 ${counts.processed}, 대기 ${counts.pending}`);
  }

  return {
    type: "source_event",
    distribution,
  };
}

/**
 * 종합 리포트 생성
 */
async function generateReport(outputPath = null) {
  console.log("=========================================");
  console.log("        데이터 분포 분석 리포트         ");
  console.log("=========================================");
  console.log(`분석 시간: ${new Date().toISOString()}\n`);

  const report = {
    generatedAt: new Date().toISOString(),
    memo: await analyzeMemos(),
    chat: await analyzeChats(),
    sourceEvent: await analyzeSourceEvents(),
    fact: await analyzeFacts(),
  };

  // 이상 징후 체크
  console.log("\n=== 이상 징후 체크 ===\n");
  const warnings = [];

  if (report.memo.duplicateRate > 0.1) {
    warnings.push(`⚠ 메모 중복률이 높음: ${(report.memo.duplicateRate * 100).toFixed(1)}%`);
  }

  if (report.memo.count < 10) {
    warnings.push(`⚠ 메모 수가 적음: ${report.memo.count}개`);
  }

  if (report.fact.count === 0) {
    warnings.push(`⚠ 추출된 fact가 없음`);
  } else {
    // fact_type 분포 불균형 체크
    const types = Object.values(report.fact.typeDistribution);
    const maxType = Math.max(...types);
    const minType = Math.min(...types);
    if (maxType / minType > 10) {
      warnings.push(`⚠ fact_type 분포가 불균형함 (최대/최소 = ${(maxType / minType).toFixed(1)})`);
    }
  }

  if (warnings.length === 0) {
    console.log("✓ 이상 징후 없음");
  } else {
    for (const warning of warnings) {
      console.log(warning);
    }
  }

  report.warnings = warnings;

  // 파일 출력 (선택)
  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n리포트 저장: ${outputPath}`);
  }

  return report;
}

/**
 * 메인 실행
 */
async function main() {
  const args = process.argv.slice(2);

  let outputPath = null;
  const outputIndex = args.indexOf("--output");
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    outputPath = args[outputIndex + 1];
  }

  try {
    await generateReport(outputPath);
  } catch (error) {
    console.error("\n오류 발생:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();

