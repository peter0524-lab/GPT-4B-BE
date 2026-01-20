/**
 * LLM Feedback Loop
 * 관계 구분이 어려우면 LLM이 피처 조작을 제안하고 재분석
 * fact-extraction/lib/llm-client.js 패턴 사용
 */
import { generateJSON } from "./llm-client.js";

/**
 * 분석 품질 평가
 * @param {Array} analysisResults - LLM 분석 결과들
 * @returns {Object} 품질 평가 결과
 */
export function evaluateAnalysisQuality(analysisResults) {
  const validResults = analysisResults.filter(r => r.analysis);
  
  if (validResults.length < 3) {
    return {
      isGood: false,
      reason: "분석된 데이터가 너무 적습니다.",
      needsIteration: true
    };
  }
  
  const scores = validResults.map(r => r.analysis.relationshipScore);
  
  // 1. 점수 분산 체크
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;
  
  // 2. 등급 다양성 체크
  const grades = new Set(validResults.map(r => r.analysis.grade));
  
  // 3. 점수 범위 체크
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore;
  
  // 문제 진단
  const issues = [];
  
  if (cv < 0.15) {
    issues.push({
      type: "LOW_VARIANCE",
      message: `점수 분산이 너무 낮음 (CV=${(cv * 100).toFixed(1)}%)`,
      severity: "high"
    });
  }
  
  if (grades.size <= 2) {
    issues.push({
      type: "LOW_GRADE_DIVERSITY",
      message: `등급 다양성 부족 (${grades.size}종류만 존재)`,
      severity: "medium"
    });
  }
  
  if (range < 25) {
    issues.push({
      type: "NARROW_RANGE",
      message: `점수 범위가 좁음 (${minScore}~${maxScore}, 범위=${range})`,
      severity: "high"
    });
  }
  
  // 모두 비슷한 관계 유형인지 체크
  const types = validResults.map(r => r.analysis.relationshipType);
  const typeCount = {};
  types.forEach(t => typeCount[t] = (typeCount[t] || 0) + 1);
  const dominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0];
  if (dominantType && dominantType[1] / types.length > 0.8) {
    issues.push({
      type: "HOMOGENEOUS_TYPES",
      message: `관계 유형이 대부분 동일함 (${dominantType[0]}: ${Math.round(dominantType[1] / types.length * 100)}%)`,
      severity: "medium"
    });
  }
  
  return {
    isGood: issues.filter(i => i.severity === "high").length === 0,
    issues,
    metrics: {
      cv: Math.round(cv * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      range,
      gradeCount: grades.size,
      mean: Math.round(mean * 100) / 100
    },
    needsIteration: issues.some(i => i.severity === "high")
  };
}

/**
 * LLM에게 피처 조작 전략 요청
 * @param {Object} qualityEval - 품질 평가 결과
 * @param {Array} currentFeatures - 현재 사용 중인 피처 목록
 * @param {Object} featureStats - 피처 통계
 * @returns {Object} 피처 조작 전략
 */
export async function requestFeatureStrategy(qualityEval, currentFeatures, featureStats) {
  const prompt = buildStrategyPrompt(qualityEval, currentFeatures, featureStats);
  
  const systemPrompt = `당신은 데이터 분석 전문가입니다. 
관계 분석에서 구분력이 낮은 문제를 해결하기 위한 피처 조작 전략을 제안해야 합니다.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "diagnosis": "문제 진단 요약",
  "strategy": "전체적인 전략 설명",
  "featureOperations": [
    {
      "operation": "CREATE" | "TRANSFORM" | "WEIGHT" | "REMOVE" | "COMBINE",
      "targetFeature": "대상 피처명",
      "description": "무엇을 어떻게 할지",
      "formula": "계산 공식 (선택)",
      "rationale": "왜 이 조작이 필요한지"
    }
  ],
  "expectedImprovement": "예상되는 개선 효과",
  "dataRecommendations": [
    "추가로 수집하면 좋을 데이터 제안"
  ]
}`;
  
  try {
    return await generateJSON(prompt, {
      systemPrompt,
      temperature: 0.4,
      maxTokens: 1500,
    });
  } catch (error) {
    console.error("피처 전략 요청 오류:", error);
    throw error;
  }
}

/**
 * 전략 프롬프트 생성
 */
function buildStrategyPrompt(qualityEval, currentFeatures, featureStats) {
  let prompt = `## 현재 관계 분석 품질 문제

### 발견된 문제점
${qualityEval.issues.map(i => `- [${i.severity}] ${i.message}`).join('\n')}

### 현재 분석 지표
- 변동계수(CV): ${qualityEval.metrics.cv}
- 표준편차: ${qualityEval.metrics.stdDev}
- 점수 범위: ${qualityEval.metrics.range}
- 등급 종류: ${qualityEval.metrics.gradeCount}개
- 평균 점수: ${qualityEval.metrics.mean}

### 현재 사용 중인 피처 (${currentFeatures.length}개)
`;

  // 피처별 통계 추가
  for (const feature of currentFeatures) {
    const stats = featureStats[feature];
    if (stats) {
      prompt += `\n**${feature}**
  - 평균: ${stats.mean}, 표준편차: ${stats.stdDev}
  - 범위: ${stats.min} ~ ${stats.max}
  - 변동계수: ${stats.cv}
  - 고유값 수: ${stats.uniqueValues}
`;
    }
  }

  prompt += `
### 요청사항
위 문제를 해결하기 위한 피처 조작 전략을 제안해주세요.
목표는 사람들 간의 관계 차이를 더 명확하게 구분할 수 있도록 하는 것입니다.

가능한 조작:
1. CREATE: 기존 피처를 조합하여 새 피처 생성
2. TRANSFORM: 피처 값 변환 (로그, 정규화, 버킷팅 등)
3. WEIGHT: 특정 피처의 중요도 조정
4. REMOVE: 구분력 없는 피처 제거
5. COMBINE: 여러 피처를 하나로 결합

예시:
- CREATE: "engagement_score = totalMeetings * 0.3 + totalMemos * 0.3 + totalGifts * 0.4"
- TRANSFORM: "daysSinceLastMeeting → recency_bucket (최근/보통/오래됨)"
- COMBINE: "interaction_intensity = log(totalMeetings + 1) + log(totalMemos + 1)"
`;

  return prompt;
}

/**
 * 피처 조작 실행
 * @param {Array} allCardFeatures - 모든 카드의 피처
 * @param {Array} operations - 피처 조작 목록
 * @returns {Array} 조작된 피처 데이터
 */
export function executeFeatureOperations(allCardFeatures, operations) {
  const modifiedFeatures = JSON.parse(JSON.stringify(allCardFeatures)); // Deep copy
  
  for (const op of operations) {
    console.log(`피처 조작 실행: ${op.operation} - ${op.targetFeature}`);
    
    switch (op.operation) {
      case "CREATE":
        executeCreateOperation(modifiedFeatures, op);
        break;
      case "TRANSFORM":
        executeTransformOperation(modifiedFeatures, op);
        break;
      case "REMOVE":
        executeRemoveOperation(modifiedFeatures, op);
        break;
      case "COMBINE":
        executeCombineOperation(modifiedFeatures, op);
        break;
      case "WEIGHT":
        // WEIGHT는 분석 시점에 적용
        break;
    }
  }
  
  return modifiedFeatures;
}

/**
 * CREATE 연산 실행
 */
function executeCreateOperation(features, op) {
  const formula = op.formula;
  if (!formula) return;
  
  for (const card of features) {
    try {
      // 간단한 수식 파싱 (예: "totalMeetings * 0.3 + totalMemos * 0.3")
      let result = formula;
      for (const [key, value] of Object.entries(card.features)) {
        result = result.replace(new RegExp(key, 'g'), value || 0);
      }
      // eval 대신 Function 사용 (보안상 더 나음)
      const compute = new Function(`return ${result}`);
      card.features[op.targetFeature] = compute();
    } catch (e) {
      card.features[op.targetFeature] = 0;
    }
  }
}

/**
 * TRANSFORM 연산 실행
 */
function executeTransformOperation(features, op) {
  const description = op.description.toLowerCase();
  
  for (const card of features) {
    const value = card.features[op.targetFeature];
    if (value === undefined || value === null) continue;
    
    if (description.includes("log")) {
      card.features[op.targetFeature] = Math.log(value + 1);
    } else if (description.includes("bucket") || description.includes("버킷")) {
      // 버킷팅 (최근/보통/오래됨)
      if (description.includes("recency") || description.includes("경과일")) {
        if (value <= 30) card.features[`${op.targetFeature}_bucket`] = 3; // 최근
        else if (value <= 90) card.features[`${op.targetFeature}_bucket`] = 2; // 보통
        else card.features[`${op.targetFeature}_bucket`] = 1; // 오래됨
      }
    } else if (description.includes("normalize") || description.includes("정규화")) {
      // 0-1 정규화는 전체 데이터 필요하므로 별도 처리
    }
  }
}

/**
 * REMOVE 연산 실행
 */
function executeRemoveOperation(features, op) {
  for (const card of features) {
    delete card.features[op.targetFeature];
  }
}

/**
 * COMBINE 연산 실행
 */
function executeCombineOperation(features, op) {
  const formula = op.formula;
  if (!formula) return;
  
  for (const card of features) {
    try {
      let result = formula;
      for (const [key, value] of Object.entries(card.features)) {
        result = result.replace(new RegExp(key, 'g'), value || 0);
      }
      const compute = new Function(`return ${result}`);
      card.features[op.targetFeature] = compute();
    } catch (e) {
      card.features[op.targetFeature] = 0;
    }
  }
}

/**
 * 피드백 루프 전체 실행
 * @param {Function} extractFeatures - 피처 추출 함수
 * @param {Function} filterFeatures - 피처 필터링 함수
 * @param {Function} analyzeRelationships - 관계 분석 함수
 * @param {Object} options - 옵션
 */
export async function runFeedbackLoop(
  allFeatures,
  filterResult,
  analyzeFunc,
  options = {}
) {
  const {
    maxIterations = 3,
    userId = 1,
  } = options;
  
  let iteration = 0;
  let currentFeatures = allFeatures;
  let currentFilterResult = filterResult;
  let analysisResults = null;
  let quality = null;
  
  const history = [];
  
  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n=== 피드백 루프 반복 ${iteration}/${maxIterations} ===`);
    
    // 1. 관계 분석 실행
    console.log("1. 관계 분석 중...");
    analysisResults = await analyzeFunc(currentFeatures, currentFilterResult);
    
    // 2. 품질 평가
    console.log("2. 품질 평가 중...");
    quality = evaluateAnalysisQuality(analysisResults);
    
    history.push({
      iteration,
      quality,
      featureCount: currentFilterResult.significantFeatures.length
    });
    
    console.log(`   품질 평가: ${quality.isGood ? '✓ 양호' : '✗ 개선 필요'}`);
    
    // 3. 품질이 좋으면 종료
    if (quality.isGood || !quality.needsIteration) {
      console.log("   품질이 충분합니다. 루프 종료.");
      break;
    }
    
    // 4. LLM에게 피처 전략 요청
    console.log("3. LLM에게 피처 조작 전략 요청 중...");
    const strategy = await requestFeatureStrategy(
      quality,
      currentFilterResult.significantFeatures,
      currentFilterResult.featureStats
    );
    
    console.log(`   전략: ${strategy.strategy}`);
    console.log(`   조작 수: ${strategy.featureOperations.length}개`);
    
    // 5. 피처 조작 실행
    console.log("4. 피처 조작 실행 중...");
    currentFeatures = executeFeatureOperations(currentFeatures, strategy.featureOperations);
    
    // 6. 조작된 피처로 필터링 다시 실행
    // (filterFeatures는 외부에서 전달받아야 함)
    
    history[history.length - 1].strategy = strategy;
  }
  
  return {
    finalAnalysis: analysisResults,
    finalQuality: quality,
    iterations: iteration,
    history,
    improved: history.length > 1 && quality.isGood
  };
}

/**
 * 단순화된 자동 피드백 루프
 */
export async function autoImproveAnalysis(analysisResults, allFeatures, filterResult) {
  // 1. 품질 평가
  const quality = evaluateAnalysisQuality(analysisResults);
  
  if (quality.isGood) {
    return {
      needsImprovement: false,
      message: "분석 품질이 양호합니다.",
      quality
    };
  }
  
  // 2. LLM에게 전략 요청
  const strategy = await requestFeatureStrategy(
    quality,
    filterResult.significantFeatures,
    filterResult.featureStats
  );
  
  // 3. 피처 조작
  const modifiedFeatures = executeFeatureOperations(allFeatures, strategy.featureOperations);
  
  return {
    needsImprovement: true,
    quality,
    strategy,
    modifiedFeatures,
    message: "피처 조작 전략이 생성되었습니다. 재분석이 필요합니다."
  };
}

