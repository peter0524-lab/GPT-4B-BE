import express from "express";
import pool from "../config/database.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { processLLMChat } from "../services/llm.service.js";

const router = express.Router();

router.use(authenticate);

const dedupe = (items) => {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    if (!item || seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });
  return result;
};

const parseLLMJson = (content) => {
  if (!content) return null;
  const trimmed = String(content).trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = fencedMatch ? fencedMatch[1] : trimmed;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const getStage1KeywordsFromLLM = async (query) => {
  const prompt = `
너는 "명함집 자연어 검색"의 키워드 추출기다.
사용자 질문에서 evidence 검색에 유효한 핵심 키워드만 추출한다.

[규칙]
- 가장 구체적이고 고유한 의미를 가진 단어(예: 농산물, 테니스)를 1순위로 배치한다.
- 일반적인 행위나 포괄적인 단어(예: 미팅, 회의, 업무)는 후순위로 배치한다.
- 불필요한 조사/관계어/일반어는 제거한다.
- "누구/사람/같이/최근" 같은 일반어는 제외한다.
- 최대 3~4개로 제한하며, 중요도 순서대로 배열에 담는다.

[출력 형식]
JSON만 출력:
{
  "keywords": ["1순위_키워드", "2순위_키워드"]
}

[예시]
입력: "그 예전에 농산물 관련해서 미팅 같이 한 사람"
출력: {"keywords": ["농산물", "미팅"]}

입력: "강남역 근처에서 삼겹살 먹었던 거래처 직원"
출력: {"keywords": ["삼겹살", "강남역"]}
  `.trim();

  const response = await processLLMChat(
    [
      { role: "system", content: "You extract Korean search keywords. Return JSON only." },
      { role: "user", content: `질문: "${query}"\n\n${prompt}` },
    ],
    "gpt"
  );

  const parsed = parseLLMJson(response);
  if (!parsed) return [];
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map(String).map((kw) => kw.trim()).filter(Boolean)
    : [];
  return dedupe(keywords).slice(0, 8);
};

const getStage2KeywordsFromLLM = async (query) => {
  const prompt = `
너는 "명함집 자연어 검색"의 2차(완화) 키워드 추출기다.
1차 검색 결과가 없을 때 더 넓게 매칭되도록 키워드를 추출한다.

[규칙]
- 1차보다 추상적/완화된 단어로 구성한다.
- 키워드 개수는 1~3개로 줄인다.
- 너무 일반적인 단어만 남기지 않는다.
- 한국어 그대로 유지한다.

[출력 형식]
JSON만 출력:
{
  "keywords": ["완화키워드1", "완화키워드2"]
}

[예시]
입력: "테니스에 관심 많은 사람"
출력: {"keywords":["스포츠","운동"]}
  `.trim();

  const response = await processLLMChat(
    [
      { role: "system", content: "You extract relaxed Korean search keywords. Return JSON only." },
      { role: "user", content: `질문: "${query}"\n\n${prompt}` },
    ],
    "gpt"
  );

  const parsed = parseLLMJson(response);
  if (!parsed) return [];
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords.map(String).map((kw) => kw.trim()).filter(Boolean)
    : [];
  return dedupe(keywords).slice(0, 4);
};

const buildSearchSql = (keywords) => {
  if (!keywords || keywords.length === 0) {
    return {
      sql: "SELECT card_id, 0 AS score FROM HCI_2025.extracted_fact WHERE 1 = 0",
      params: [],
    };
  }

  const scoreExpr = keywords
    .map(() => "CASE WHEN evidence LIKE ? THEN 1 ELSE 0 END")
    .join(" + ");
  const whereExpr = keywords.map(() => "evidence LIKE ?").join(" OR ");

  const sql = `
SELECT card_id,
       (${scoreExpr}) AS score
FROM HCI_2025.extracted_fact
WHERE ${whereExpr}
GROUP BY card_id
HAVING score > 0
ORDER BY score DESC, COUNT(*) DESC
LIMIT 100
  `.trim();

  const likeParams = keywords.map((keyword) => `%${keyword}%`);
  return {
    sql,
    params: [...likeParams, ...likeParams],
  };
};

const searchByPriorityKeywords = async (keywords) => {
  for (const keyword of keywords) {
    const sql = buildSearchSql([keyword]);
    const [rows] = await pool.query(sql.sql, sql.params);
    if (rows.length > 0) {
      return {
        cardIds: rows.map((row) => row.card_id),
        usedKeywords: [keyword],
        sql,
      };
    }
  }
  return {
    cardIds: [],
    usedKeywords: [],
    sql: buildSearchSql([]),
  };
};

const buildEvidenceSql = (cardIds, keywords) => {
  if (!Array.isArray(cardIds) || cardIds.length === 0 || !keywords || keywords.length === 0) {
    return {
      sql: "SELECT card_id, evidence FROM HCI_2025.extracted_fact WHERE 1 = 0",
      params: [],
    };
  }

  const cardPlaceholders = cardIds.map(() => "?").join(", ");
  const whereExpr = keywords.map(() => "evidence LIKE ?").join(" OR ");

  const sql = `
SELECT card_id, evidence
FROM HCI_2025.extracted_fact
WHERE card_id IN (${cardPlaceholders})
  AND (${whereExpr})
ORDER BY card_id ASC, id DESC
  `.trim();

  const likeParams = keywords.map((keyword) => `%${keyword}%`);
  return {
    sql,
    params: [...cardIds, ...likeParams],
  };
};

const buildEvidenceMap = (rows, limit = 2) => {
  const map = {};
  rows.forEach((row) => {
    const cardId = String(row.card_id);
    const evidence = String(row.evidence || "").trim();
    if (!evidence) return;
    if (!map[cardId]) map[cardId] = [];
    if (map[cardId].includes(evidence)) return;
    if (map[cardId].length < limit) {
      map[cardId].push(evidence);
    }
  });
  return map;
};

const filterByContextLLM = async (query, evidenceMap) => {
  if (Object.keys(evidenceMap).length === 0) {
    return { filteredCardIds: [], filteredEvidenceMap: {} };
  }

  const evidenceList = [];
  Object.entries(evidenceMap).forEach(([cardId, evidences]) => {
    evidences.forEach((ev, idx) => {
      evidenceList.push({ cardId, evidence: ev, index: `${cardId}_${idx}` });
    });
  });

  if (evidenceList.length === 0) {
    return { filteredCardIds: [], filteredEvidenceMap: {} };
  }

  const prompt = `
너는 "명함집 자연어 검색"의 맥락 필터링 전문가다.
사용자 질문과 검색된 근거(evidence)들을 비교해서, 질문의 의도에 부합하는 근거만 골라낸다.

[사용자 질문]
"${query}"

[검색된 근거 목록]
${evidenceList.map((e, i) => `${i + 1}. [${e.index}] ${e.evidence}`).join("\n")}

[규칙]
- 질문과 명백히 반대되는 의미의 근거만 제외한다. (예: "좋아함" vs "싫어함", "알레르기")
- 예: "해산물 좋아하는 사람" 질문에 "해산물 알레르기" 근거는 제외한다.
- 예: "테니스 좋아하는 사람" 질문에 "테니스를 싫어함" 근거는 제외한다.
- 관련 키워드가 포함되어 있으면 기본적으로 포함시킨다.
- 확신이 없거나 애매한 경우 제외하지 말고 포함시킨다.
- 가능하면 많은 결과를 포함시키는 방향으로 판단한다.

[출력 형식]
JSON만 출력:
{
  "selected": ["cardId_idx", "cardId_idx"]
}

예시: {"selected": ["5_0", "12_1"]}
선택된 근거가 없으면: {"selected": []}
  `.trim();

  try {
    const response = await processLLMChat(
      [
        { role: "system", content: "You are a context filter for search results. Return JSON only." },
        { role: "user", content: prompt },
      ],
      "gpt"
    );

    const parsed = parseLLMJson(response);
    if (!parsed || !Array.isArray(parsed.selected)) {
      console.log("[CardSearch] Context filter LLM failed to parse, keeping all results");
      return {
        filteredCardIds: Object.keys(evidenceMap),
        filteredEvidenceMap: evidenceMap,
      };
    }

    const selectedSet = new Set(parsed.selected);
    const filteredEvidenceMap = {};
    const filteredCardIdSet = new Set();

    evidenceList.forEach((e) => {
      if (selectedSet.has(e.index)) {
        if (!filteredEvidenceMap[e.cardId]) filteredEvidenceMap[e.cardId] = [];
        filteredEvidenceMap[e.cardId].push(e.evidence);
        filteredCardIdSet.add(e.cardId);
      }
    });

    console.log("[CardSearch] Context filter: before =", Object.keys(evidenceMap).length, "cards, after =", filteredCardIdSet.size, "cards");

    return {
      filteredCardIds: Array.from(filteredCardIdSet),
      filteredEvidenceMap,
    };
  } catch (error) {
    console.error("[CardSearch] Context filter error:", error.message);
    return {
      filteredCardIds: Object.keys(evidenceMap),
      filteredEvidenceMap: evidenceMap,
    };
  }
};

const searchAndFilter = async (query, keywords) => {
  if (!keywords || keywords.length === 0) {
    return {
      cardIds: [],
      usedKeywords: [],
      sql: buildSearchSql([]),
      evidenceMap: {},
      filteredCardIds: [],
      filteredEvidenceMap: {},
    };
  }

  const searchResult = await searchByPriorityKeywords(keywords);
  const { cardIds, usedKeywords, sql } = searchResult;

  if (cardIds.length === 0) {
    return {
      cardIds: [],
      usedKeywords,
      sql,
      evidenceMap: {},
      filteredCardIds: [],
      filteredEvidenceMap: {},
    };
  }

  const evidenceSql = buildEvidenceSql(cardIds, usedKeywords);
  const [evidenceRows] = await pool.query(evidenceSql.sql, evidenceSql.params);
  const evidenceMap = buildEvidenceMap(evidenceRows);

  const filterResult = await filterByContextLLM(query, evidenceMap);
  const filteredCardIds = filterResult.filteredCardIds.map(Number);
  const filteredEvidenceMap = filterResult.filteredEvidenceMap;

  return {
    cardIds,
    usedKeywords,
    sql,
    evidenceMap,
    filteredCardIds,
    filteredEvidenceMap,
  };
};

router.post("/", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    if (!query) {
      return res.status(400).json({
        success: false,
        message: "검색어가 비어 있습니다.",
      });
    }

    const stage1Keywords = await getStage1KeywordsFromLLM(query);
    console.log("[CardSearch] stage1 keywords:", stage1Keywords);

    let stageUsed = "stage1";
    let stage2Keywords = [];
    let stage1Sql = buildSearchSql([]);
    let stage2Sql = buildSearchSql([]);

    const stage1 = await searchAndFilter(query, stage1Keywords);
    stage1Sql = stage1.sql;

    let finalCardIds = stage1.filteredCardIds;
    let finalEvidenceMap = stage1.filteredEvidenceMap;
    let activeKeywords = stage1.usedKeywords;
    let rawCardIds = stage1.cardIds;
    let rawEvidenceMap = stage1.evidenceMap;

    if (finalCardIds.length === 0) {
      console.log("[CardSearch] Stage1 filtered to 0, trying stage2...");
      stage2Keywords = await getStage2KeywordsFromLLM(query);
      console.log("[CardSearch] stage2 keywords:", stage2Keywords);

      const stage2 = await searchAndFilter(query, stage2Keywords);
      stage2Sql = stage2.sql;
      stageUsed = "stage2";

      finalCardIds = stage2.filteredCardIds;
      finalEvidenceMap = stage2.filteredEvidenceMap;
      activeKeywords = stage2.usedKeywords;
      rawCardIds = stage2.cardIds;
      rawEvidenceMap = stage2.evidenceMap;
    }

    return res.json({
      success: true,
      data: {
        stageUsed,
        cardIds: finalCardIds,
        keywords: {
          stage1: stage1Keywords,
          stage2: stage2Keywords,
          active: activeKeywords,
        },
        sql: {
          stage1: stage1Sql.sql,
          stage2: stage2Sql.sql,
        },
        evidenceMap: finalEvidenceMap,
        rawCardIds,
        rawEvidenceMap,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;

