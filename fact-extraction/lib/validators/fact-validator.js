/**
 * fact 검증 모듈
 * LLM이 출력한 JSON을 검증하고 정제
 */

import { config } from "../../config.js";

/**
 * fact_type 유효성 검사
 */
export const isValidFactType = (factType) => {
  return config.factTypes.includes(factType);
};

/**
 * 단일 fact 검증
 * @param {Object} fact - 검증할 fact
 * @returns {Object} { valid: boolean, errors: string[], sanitized: Object }
 */
export const validateFact = (fact) => {
  const errors = [];
  const sanitized = { ...fact };

  // fact_type 검증
  if (!fact.fact_type) {
    errors.push("fact_type is required");
  } else if (!isValidFactType(fact.fact_type)) {
    errors.push(`Invalid fact_type: ${fact.fact_type}. Must be one of: ${config.factTypes.join(", ")}`);
  }

  // fact_key 검증
  if (!fact.fact_key || typeof fact.fact_key !== "string") {
    errors.push("fact_key is required and must be a string");
  } else {
    // fact_key 정제 (최대 255자, 트림)
    sanitized.fact_key = fact.fact_key.trim().substring(0, 255);
  }

  // confidence 검증 및 정제
  if (fact.confidence !== undefined) {
    const conf = parseFloat(fact.confidence);
    if (isNaN(conf) || conf < 0 || conf > 1) {
      errors.push("confidence must be a number between 0 and 1");
      sanitized.confidence = 0.5; // 기본값
    } else {
      sanitized.confidence = conf;
    }
  } else {
    sanitized.confidence = 0.5; // 기본값
  }

  // evidence 검증
  if (!fact.evidence || typeof fact.evidence !== "string") {
    errors.push("evidence is required and must be a string");
  } else {
    sanitized.evidence = fact.evidence.trim();
  }

  // polarity 정제 (-1, 0, +1)
  // fact_type에 따라 기본 polarity 설정
  const defaultPolarity = {
    'PREFERENCE': 1,    // 긍정/선호
    'DISLIKE': -1,      // 부정/비선호
    'RISK': -1,         // 위험/주의
    'CONSTRAINT': 0,    // 중립/제약
    'DATE': 0,          // 중립/정보
    'ROLE_OR_ORG': 0,   // 중립/정보
    'INTERACTION': 0,   // 중립/정보
    'CONTEXT': 0,       // 중립/정보
  };
  
  if (fact.polarity !== undefined && fact.polarity !== null) {
    const p = parseInt(fact.polarity);
    // -1, 0, 1만 허용
    sanitized.polarity = (p >= 1) ? 1 : (p <= -1) ? -1 : 0;
  } else {
    // fact_type에 따른 기본값
    sanitized.polarity = defaultPolarity[sanitized.fact_type] ?? 0;
  }
  
  // action과 invalidate_key도 전달 (INVALIDATE 처리용)
  if (fact.action) {
    sanitized.action = fact.action;
  }
  if (fact.invalidate_key) {
    sanitized.invalidate_key = fact.invalidate_key;
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
};

/**
 * fact 배열 검증
 * @param {Array} facts - 검증할 fact 배열
 * @returns {Object} { validFacts: Array, invalidFacts: Array, summary: Object }
 */
export const validateFacts = (facts) => {
  if (!Array.isArray(facts)) {
    return {
      validFacts: [],
      invalidFacts: [{ original: facts, errors: ["Input must be an array"] }],
      summary: { total: 0, valid: 0, invalid: 1 },
    };
  }

  const validFacts = [];
  const invalidFacts = [];

  for (const fact of facts) {
    const result = validateFact(fact);
    if (result.valid) {
      validFacts.push(result.sanitized);
    } else {
      invalidFacts.push({
        original: fact,
        errors: result.errors,
      });
    }
  }

  return {
    validFacts,
    invalidFacts,
    summary: {
      total: facts.length,
      valid: validFacts.length,
      invalid: invalidFacts.length,
    },
  };
};

/**
 * 중복 fact 제거 (같은 fact_type + fact_key 조합)
 * confidence가 높은 것 우선
 */
export const deduplicateFacts = (facts) => {
  const factMap = new Map();

  for (const fact of facts) {
    const key = `${fact.fact_type}:${fact.fact_key.toLowerCase()}`;
    const existing = factMap.get(key);

    if (!existing || fact.confidence > existing.confidence) {
      factMap.set(key, fact);
    }
  }

  return Array.from(factMap.values());
};

export default {
  isValidFactType,
  validateFact,
  validateFacts,
  deduplicateFacts,
};

