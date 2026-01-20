/**
 * Feature Filter
 * 유의미한 피처만 선별 (분산이 낮은 피처는 제외)
 */
import config from "../config.js";

/**
 * 모든 카드의 피처 데이터에서 유의미한 피처만 필터링
 * @param {Array} allCardFeatures - extractFeaturesForAllCards 결과
 * @returns {Object} 필터링 결과
 */
export function filterSignificantFeatures(allCardFeatures) {
  if (!allCardFeatures || allCardFeatures.length === 0) {
    return { filteredFeatures: [], featureStats: {}, excludedFeatures: [] };
  }
  
  // 1. 모든 피처 키 수집
  const allFeatureKeys = new Set();
  for (const card of allCardFeatures) {
    Object.keys(card.features).forEach(key => allFeatureKeys.add(key));
  }
  
  // 2. 각 피처의 통계 계산
  const featureStats = {};
  const excludedFeatures = [];
  const significantFeatures = [];
  
  for (const featureKey of allFeatureKeys) {
    const values = allCardFeatures
      .map(card => card.features[featureKey])
      .filter(v => v !== null && v !== undefined && !isNaN(v));
    
    if (values.length === 0) {
      excludedFeatures.push({
        key: featureKey,
        reason: "데이터 없음",
        coverage: 0
      });
      continue;
    }
    
    const stats = calculateStats(values);
    stats.coverage = values.length / allCardFeatures.length;
    stats.featureKey = featureKey;
    
    featureStats[featureKey] = stats;
    
    // 3. 필터링 기준 적용
    const filterResult = applyFilterCriteria(featureKey, stats);
    
    if (filterResult.isSignificant) {
      significantFeatures.push({
        key: featureKey,
        stats,
        importance: filterResult.importance
      });
    } else {
      excludedFeatures.push({
        key: featureKey,
        reason: filterResult.reason,
        stats
      });
    }
  }
  
  // 4. 중요도 순으로 정렬
  significantFeatures.sort((a, b) => b.importance - a.importance);
  
  // 5. 필터링된 데이터 생성
  const filteredFeatures = allCardFeatures.map(card => ({
    cardId: card.cardId,
    cardInfo: card.cardInfo,
    features: Object.fromEntries(
      significantFeatures.map(sf => [sf.key, card.features[sf.key]])
    )
  }));
  
  return {
    filteredFeatures,
    significantFeatures: significantFeatures.map(sf => sf.key),
    featureStats,
    excludedFeatures,
    summary: {
      totalFeatures: allFeatureKeys.size,
      significantCount: significantFeatures.length,
      excludedCount: excludedFeatures.length,
      filterCriteria: config.featureFilter
    }
  };
}

/**
 * 통계 계산
 */
function calculateStats(values) {
  const n = values.length;
  
  // 평균
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  
  // 분산
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  
  // 표준편차
  const stdDev = Math.sqrt(variance);
  
  // 변동 계수 (Coefficient of Variation)
  const cv = mean !== 0 ? stdDev / Math.abs(mean) : 0;
  
  // 최소/최대
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  // 범위
  const range = max - min;
  
  // 고유 값 수
  const uniqueValues = new Set(values).size;
  
  // 엔트로피 (카테고리형 피처용)
  const entropy = calculateEntropy(values);
  
  // 사분위수
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)];
  const median = sorted[Math.floor(n * 0.5)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  
  return {
    count: n,
    mean: round(mean),
    stdDev: round(stdDev),
    variance: round(variance),
    cv: round(cv),
    min: round(min),
    max: round(max),
    range: round(range),
    uniqueValues,
    entropy: round(entropy),
    q1: round(q1),
    median: round(median),
    q3: round(q3),
    iqr: round(iqr)
  };
}

/**
 * 엔트로피 계산 (다양성 측정)
 */
function calculateEntropy(values) {
  const counts = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  
  const n = values.length;
  let entropy = 0;
  
  for (const count of Object.values(counts)) {
    const p = count / n;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  
  // 정규화 (0~1)
  const maxEntropy = Math.log2(Object.keys(counts).length);
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

/**
 * 필터링 기준 적용
 */
function applyFilterCriteria(featureKey, stats) {
  const criteria = config.featureFilter;
  
  // 1. 데이터 커버리지 체크
  if (stats.coverage < criteria.minDataCoverage) {
    return {
      isSignificant: false,
      reason: `데이터 커버리지 부족 (${round(stats.coverage * 100)}% < ${criteria.minDataCoverage * 100}%)`
    };
  }
  
  // 2. 모든 값이 동일한 경우 제외
  if (stats.uniqueValues === 1) {
    return {
      isSignificant: false,
      reason: `모든 값 동일 (${stats.mean})`
    };
  }
  
  // 3. Boolean 피처는 분포 체크
  if (featureKey.startsWith("is") || featureKey.startsWith("has")) {
    // 90% 이상이 같은 값이면 제외
    const dominantRatio = Math.max(
      stats.mean, // 1의 비율
      1 - stats.mean // 0의 비율
    );
    if (dominantRatio > 0.9) {
      return {
        isSignificant: false,
        reason: `편향된 boolean (${round(dominantRatio * 100)}% 동일)`
      };
    }
    return { isSignificant: true, importance: 0.5 };
  }
  
  // 4. 변동 계수 체크 (수치형 피처)
  if (stats.cv < criteria.minCoefficientOfVariation) {
    return {
      isSignificant: false,
      reason: `분산 부족 (CV=${round(stats.cv)} < ${criteria.minCoefficientOfVariation})`
    };
  }
  
  // 5. 중요도 계산
  const importance = calculateFeatureImportance(featureKey, stats);
  
  return {
    isSignificant: true,
    importance
  };
}

/**
 * 피처 중요도 계산
 */
function calculateFeatureImportance(featureKey, stats) {
  let importance = 0;
  
  // 변동 계수 기반 (높을수록 구분력 좋음)
  importance += Math.min(stats.cv, 2) * 0.3;
  
  // 엔트로피 기반 (높을수록 다양성 좋음)
  importance += stats.entropy * 0.2;
  
  // 데이터 커버리지 기반
  importance += stats.coverage * 0.2;
  
  // 특정 피처 가중치
  const highPriorityFeatures = [
    "totalMeetings", "meetingsLast30Days", "daysSinceLastMeeting",
    "totalMemos", "totalGifts", "totalFacts", "isFavorite"
  ];
  if (highPriorityFeatures.includes(featureKey)) {
    importance += 0.3;
  }
  
  return round(importance);
}

/**
 * 반올림 헬퍼
 */
function round(value, decimals = 3) {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * 피처 분포 시각화용 데이터 생성
 */
export function generateFeatureDistributionData(allCardFeatures, featureKey) {
  const values = allCardFeatures
    .map(card => ({
      cardId: card.cardId,
      name: card.cardInfo?.name || `Card ${card.cardId}`,
      value: card.features[featureKey]
    }))
    .filter(item => item.value !== null && item.value !== undefined);
  
  // 히스토그램 bins
  const numBins = 10;
  const min = Math.min(...values.map(v => v.value));
  const max = Math.max(...values.map(v => v.value));
  const binWidth = (max - min) / numBins || 1;
  
  const histogram = Array(numBins).fill(0);
  for (const item of values) {
    const binIndex = Math.min(Math.floor((item.value - min) / binWidth), numBins - 1);
    histogram[binIndex]++;
  }
  
  return {
    featureKey,
    values: values.sort((a, b) => b.value - a.value),
    histogram: {
      bins: Array.from({ length: numBins }, (_, i) => round(min + i * binWidth)),
      counts: histogram,
      binWidth: round(binWidth)
    },
    stats: calculateStats(values.map(v => v.value))
  };
}

/**
 * 피처 상관관계 분석
 */
export function analyzeFeatureCorrelations(allCardFeatures, significantFeatures) {
  if (significantFeatures.length < 2) return [];
  
  const correlations = [];
  
  for (let i = 0; i < significantFeatures.length; i++) {
    for (let j = i + 1; j < significantFeatures.length; j++) {
      const feature1 = significantFeatures[i];
      const feature2 = significantFeatures[j];
      
      const pairs = allCardFeatures
        .filter(card => 
          card.features[feature1] !== null && 
          card.features[feature1] !== undefined &&
          card.features[feature2] !== null && 
          card.features[feature2] !== undefined
        )
        .map(card => [card.features[feature1], card.features[feature2]]);
      
      if (pairs.length < 5) continue;
      
      const correlation = pearsonCorrelation(
        pairs.map(p => p[0]),
        pairs.map(p => p[1])
      );
      
      if (Math.abs(correlation) > 0.5) {
        correlations.push({
          feature1,
          feature2,
          correlation: round(correlation),
          strength: Math.abs(correlation) > 0.7 ? "강함" : "중간"
        });
      }
    }
  }
  
  return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

/**
 * 피어슨 상관계수 계산
 */
function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : numerator / denom;
}


