/**
 * Graph Extraction Routes
 * 관계 그래프 생성을 위한 피처 추출 및 점수 계산 API
 * 기존 graph-extraction 서버의 라우트를 메인 서버에 통합
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// graph-extraction의 lib 파일들 import (상대 경로)
import { 
  extractFeaturesForCard, 
  extractFeaturesForAllCards,
  extractEssentialDataForLLM 
} from "../../graph-extraction/lib/feature-extractor.js";

import { 
  filterSignificantFeatures,
  generateFeatureDistributionData,
  analyzeFeatureCorrelations 
} from "../../graph-extraction/lib/feature-filter.js";

import {
  analyzeRelationshipWithLLM,
  analyzeMultipleRelationships,
  summarizeAnalysisResults
} from "../../graph-extraction/lib/llm-relationship-analyzer.js";

import {
  evaluateAnalysisQuality,
  requestFeatureStrategy,
  executeFeatureOperations,
  autoImproveAnalysis
} from "../../graph-extraction/lib/llm-feedback-loop.js";

const router = express.Router();

// ========== 헬퍼 함수 ==========

/**
 * 상호작용 점수 계산 (최근성 반영)
 * 최근 활동에 높은 가중치 부여
 */
function calculateInteractionScore(features) {
  const f = features || {};
  
  // 최근 30일 활동 (가중치 높음)
  const recentScore = 
    (f.meetingsLast30Days || 0) * 10 +  // 최근 미팅 중요
    (f.memosLast30Days || 0) * 5;       // 최근 메모
  
  // 전체 활동
  const totalScore = 
    (f.totalMeetings || 0) * 2 +
    (f.totalMemos || 0) * 1 +
    (f.totalGifts || 0) * 3 +           // 선물은 중요한 관계 표시
    (f.totalChats || 0) * 1 +
    (f.totalFacts || 0) * 0.5;
  
  // 최근성 보너스 (마지막 상호작용이 가까울수록 높음)
  const recencyBonus = 
    (f.daysSinceLastMeeting !== undefined && f.daysSinceLastMeeting < 999)
      ? Math.max(0, 30 - f.daysSinceLastMeeting) // 30일 이내면 보너스
      : 0;
  
  return recentScore + totalScore + recencyBonus;
}

// ========== 피처 추출 API ==========

/**
 * 모든 카드의 피처 추출
 * GET /api/graph/features
 */
router.get("/features", async (req, res) => {
  try {
    const userId = parseInt(req.query.userId) || 1;
    const allFeatures = await extractFeaturesForAllCards(userId);
    
    res.json({
      success: true,
      data: allFeatures,
      count: allFeatures.length
    });
  } catch (error) {
    console.error("피처 추출 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 특정 카드의 피처 추출
 * GET /api/graph/features/:cardId
 */
router.get("/features/:cardId", async (req, res) => {
  try {
    const cardId = parseInt(req.params.cardId);
    const userId = parseInt(req.query.userId) || 1;
    
    const features = await extractFeaturesForCard(cardId, userId);
    
    res.json({
      success: true,
      data: features
    });
  } catch (error) {
    console.error("피처 추출 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * LLM용 핵심 데이터 추출
 * GET /api/graph/llm-data/:cardId
 */
router.get("/llm-data/:cardId", async (req, res) => {
  try {
    const cardId = parseInt(req.params.cardId);
    const userId = parseInt(req.query.userId) || 1;
    
    const data = await extractEssentialDataForLLM(cardId, userId);
    
    if (!data) {
      return res.status(404).json({ error: "카드를 찾을 수 없습니다." });
    }
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error("LLM 데이터 추출 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== 피처 필터링 API ==========

/**
 * 유의미한 피처 필터링
 * GET /api/graph/filter
 */
router.get("/filter", async (req, res) => {
  try {
    const userId = parseInt(req.query.userId) || 1;
    
    // 1. 모든 피처 추출
    const allFeatures = await extractFeaturesForAllCards(userId);
    
    // 2. 유의미한 피처 필터링
    const filterResult = filterSignificantFeatures(allFeatures);
    
    res.json({
      success: true,
      data: filterResult
    });
  } catch (error) {
    console.error("피처 필터링 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 특정 피처의 분포 데이터
 * GET /api/graph/filter/distribution/:featureKey
 */
router.get("/filter/distribution/:featureKey", async (req, res) => {
  try {
    const featureKey = req.params.featureKey;
    const userId = parseInt(req.query.userId) || 1;
    
    const allFeatures = await extractFeaturesForAllCards(userId);
    const distribution = generateFeatureDistributionData(allFeatures, featureKey);
    
    res.json({
      success: true,
      data: distribution
    });
  } catch (error) {
    console.error("분포 데이터 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 피처 상관관계 분석
 * GET /api/graph/filter/correlations
 */
router.get("/filter/correlations", async (req, res) => {
  try {
    const userId = parseInt(req.query.userId) || 1;
    
    const allFeatures = await extractFeaturesForAllCards(userId);
    const filterResult = filterSignificantFeatures(allFeatures);
    const correlations = analyzeFeatureCorrelations(
      allFeatures, 
      filterResult.significantFeatures
    );
    
    res.json({
      success: true,
      data: correlations
    });
  } catch (error) {
    console.error("상관관계 분석 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== LLM 기반 관계 분석 API ==========

/**
 * LLM으로 특정 카드 관계 분석
 * GET /api/graph/llm-analyze/:cardId
 */
router.get("/llm-analyze/:cardId", async (req, res) => {
  try {
    const cardId = parseInt(req.params.cardId);
    const userId = parseInt(req.query.userId) || 1;
    
    console.log(`LLM 관계 분석: cardId=${cardId}`);
    
    // 1. 피처 추출
    const features = await extractFeaturesForCard(cardId, userId);
    
    // 2. LLM용 핵심 데이터 추출
    const cardData = await extractEssentialDataForLLM(cardId, userId);
    
    if (!cardData) {
      return res.status(404).json({ error: "카드를 찾을 수 없습니다." });
    }
    
    // 3. LLM 분석
    const analysis = await analyzeRelationshipWithLLM(cardData, features);
    
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error("LLM 분석 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * LLM으로 모든 카드 관계 분석 (배치)
 * GET /api/graph/llm-analyze
 */
router.get("/llm-analyze", async (req, res) => {
  try {
    const userId = parseInt(req.query.userId) || 1;
    const limit = parseInt(req.query.limit) || 20; // 비용 고려
    
    console.log(`LLM 일괄 관계 분석: userId=${userId}, limit=${limit}`);
    
    // 1. 모든 피처 추출
    const allFeatures = await extractFeaturesForAllCards(userId);
    
    // 2. 필터링 (유의미한 데이터만)
    const filterResult = filterSignificantFeatures(allFeatures);
    
    // 3. 상위 N개만 분석 (비용 절감)
    const cardsToAnalyze = filterResult.filteredFeatures.slice(0, limit);
    
    // 4. 각 카드의 LLM용 데이터 추출
    const cardsData = [];
    for (const card of cardsToAnalyze) {
      const cardData = await extractEssentialDataForLLM(card.cardId, userId);
      if (cardData) {
        cardsData.push({ 
          cardData, 
          features: { features: card.features } 
        });
      }
    }
    
    // 5. LLM 일괄 분석
    const results = await analyzeMultipleRelationships(cardsData);
    
    // 6. 요약
    const summary = summarizeAnalysisResults(results);
    
    res.json({
      success: true,
      data: {
        results,
        summary,
        usedFeatures: filterResult.significantFeatures
      }
    });
  } catch (error) {
    console.error("LLM 일괄 분석 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * LLM 분석 결과로 그래프 생성
 * GET /api/graph/llm-graph
 */
router.get("/llm-graph", async (req, res) => {
  try {
    const userId = parseInt(req.query.userId) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    // 1. LLM 분석 실행
    const allFeatures = await extractFeaturesForAllCards(userId);
    const filterResult = filterSignificantFeatures(allFeatures);
    const cardsToAnalyze = filterResult.filteredFeatures.slice(0, limit);
    
    const cardsData = [];
    for (const card of cardsToAnalyze) {
      const cardData = await extractEssentialDataForLLM(card.cardId, userId);
      if (cardData) {
        cardsData.push({ 
          cardData, 
          features: { features: card.features } 
        });
      }
    }
    
    const llmResults = await analyzeMultipleRelationships(cardsData);
    
    // 2. LLM 결과로 그래프 데이터 생성
    const nodes = [
      {
        id: "user",
        label: "나",
        type: "user",
        size: 40,
        color: "#3b82f6",
        x: 0,
        y: 0,
        fixed: true
      }
    ];
    
    const edges = [];
    
    for (const result of llmResults) {
      if (!result.analysis) continue;
      
      const analysis = result.analysis;
      const score = analysis.relationshipScore;
      
      nodes.push({
        id: `card_${result.cardId}`,
        cardId: result.cardId,
        label: result.cardInfo?.name || `Card ${result.cardId}`,
        company: result.cardInfo?.company,
        type: "contact",
        score: score,
        grade: {
          level: analysis.grade,
          label: analysis.gradeLabel,
          color: analysis.gradeColor
        },
        relationshipType: analysis.relationshipType,
        summary: analysis.summary,
        reasoning: analysis.reasoning,
        rank: result.rank,
        size: 15 + (score / 100) * 20,
        color: analysis.gradeColor,
      });
      
      edges.push({
        source: "user",
        target: `card_${result.cardId}`,
        weight: score,
        distance: 300 - (score / 100) * 200,
        width: 1 + (score / 100) * 4,
        color: analysis.gradeColor,
        label: analysis.relationshipType
      });
    }
    
    const summary = summarizeAnalysisResults(llmResults);
    
    res.json({
      success: true,
      data: {
        graph: { nodes, edges },
        summary,
        usedFeatures: filterResult.significantFeatures
      }
    });
  } catch (error) {
    console.error("LLM 그래프 생성 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

// ========== LLM 피드백 루프 API ==========

/**
 * 자동 피드백 루프 실행
 * 품질이 낮으면 LLM이 피처 조작 후 재분석
 * GET /api/graph/llm-auto
 * 
 * 타임아웃: 10분 (600초) - LLM 분석이 오래 걸릴 수 있음
 */
router.get("/llm-auto", (req, res, next) => {
  // 타임아웃을 10분(600초)으로 설정
  req.setTimeout(600000); // 10분 = 600,000ms
  res.setTimeout(600000);
  next();
}, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const maxIterations = parseInt(req.query.maxIterations) || 3;
    
    console.log(`\n🔄 자동 피드백 루프 시작 (최대 ${maxIterations}회)`);
    
    let iteration = 0;
    let currentFeatures = await extractFeaturesForAllCards(userId);
    let filterResult = filterSignificantFeatures(currentFeatures);
    let analysisResults = null;
    let quality = null;
    const history = [];
    
    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n--- 반복 ${iteration}/${maxIterations} ---`);
      
      // 1. 상호작용 점수 기반 정렬 (최근성 반영)
      const sortedByInteraction = [...filterResult.filteredFeatures].sort((a, b) => {
        const scoreA = calculateInteractionScore(a.features);
        const scoreB = calculateInteractionScore(b.features);
        return scoreB - scoreA; // 높은 순
      });
      
      // 2. 상위 N개만 분석
      const cardsToAnalyze = sortedByInteraction.slice(0, limit);
      console.log(`   상호작용 점수 상위 ${cardsToAnalyze.length}명 선택`);
      
      const cardsData = [];
      
      for (const card of cardsToAnalyze) {
        const cardData = await extractEssentialDataForLLM(card.cardId, userId);
        if (cardData) {
          cardsData.push({ cardData, features: { features: card.features } });
        }
      }
      
      // 2. LLM 분석
      console.log(`   ${cardsData.length}개 카드 분석 중...`);
      analysisResults = await analyzeMultipleRelationships(cardsData);
      
      // 3. 품질 평가
      quality = evaluateAnalysisQuality(analysisResults);
      
      history.push({
        iteration,
        quality: { ...quality },
        analyzedCount: analysisResults.length,
        featureCount: filterResult.significantFeatures.length
      });
      
      console.log(`   품질: ${quality.isGood ? '✓ 양호' : '✗ 개선 필요'}`);
      if (quality.issues.length > 0) {
        console.log(`   문제: ${quality.issues.map(i => i.type).join(', ')}`);
      }
      
      // 4. 품질이 좋으면 종료
      if (quality.isGood || !quality.needsIteration) {
        console.log(`\n✅ 분석 완료 (반복 ${iteration}회)`);
        break;
      }
      
      // 5. 마지막 반복이면 전략 없이 종료
      if (iteration >= maxIterations) {
        console.log(`\n⚠️ 최대 반복 도달, 현재 결과로 종료`);
        break;
      }
      
      // 6. LLM에게 피처 조작 전략 요청
      console.log(`   피처 조작 전략 요청 중...`);
      const strategy = await requestFeatureStrategy(
        quality,
        filterResult.significantFeatures,
        filterResult.featureStats
      );
      
      history[history.length - 1].strategy = {
        diagnosis: strategy.diagnosis,
        operations: strategy.featureOperations.map(op => ({
          operation: op.operation,
          target: op.targetFeature,
          description: op.description
        }))
      };
      
      console.log(`   전략: ${strategy.strategy}`);
      
      // 7. 피처 조작 실행
      console.log(`   ${strategy.featureOperations.length}개 피처 조작 실행...`);
      currentFeatures = executeFeatureOperations(currentFeatures, strategy.featureOperations);
      
      // 8. 재필터링
      filterResult = filterSignificantFeatures(currentFeatures);
    }
    
    // 그래프 데이터 생성
    const nodes = [
      {
        id: "user",
        label: "나",
        type: "user",
        size: 40,
        color: "#3b82f6",
        fixed: true
      }
    ];
    
    const edges = [];
    
    for (const result of analysisResults) {
      if (!result.analysis) continue;
      
      const analysis = result.analysis;
      const score = analysis.relationshipScore;
      
      nodes.push({
        id: `card_${result.cardId}`,
        cardId: result.cardId,
        label: result.cardInfo?.name || `Card ${result.cardId}`,
        company: result.cardInfo?.company,
        type: "contact",
        score,
        grade: {
          level: analysis.grade,
          label: analysis.gradeLabel,
          color: analysis.gradeColor
        },
        relationshipType: analysis.relationshipType,
        summary: analysis.summary,
        reasoning: analysis.reasoning,
        rank: result.rank,
        size: 15 + (score / 100) * 20,
        color: analysis.gradeColor,
      });
      
      edges.push({
        source: "user",
        target: `card_${result.cardId}`,
        weight: score,
        distance: 300 - (score / 100) * 200,
        width: 1 + (score / 100) * 4,
        color: analysis.gradeColor,
        label: analysis.relationshipType
      });
    }
    
    const summary = summarizeAnalysisResults(analysisResults);
    
    res.json({
      success: true,
      data: {
        graph: { nodes, edges },
        summary,
        quality,
        feedbackLoop: {
          totalIterations: iteration,
          improved: iteration > 1,
          history
        },
        usedFeatures: filterResult.significantFeatures
      }
    });
    
  } catch (error) {
    console.error("피드백 루프 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 품질 평가만 실행
 * POST /api/graph/llm-evaluate
 */
router.post("/llm-evaluate", async (req, res) => {
  try {
    const { analysisResults } = req.body;
    
    if (!analysisResults || !Array.isArray(analysisResults)) {
      return res.status(400).json({ error: "analysisResults 배열이 필요합니다." });
    }
    
    const quality = evaluateAnalysisQuality(analysisResults);
    
    res.json({
      success: true,
      data: quality
    });
  } catch (error) {
    console.error("품질 평가 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 피처 조작 전략 요청
 * POST /api/graph/llm-strategy
 */
router.post("/llm-strategy", async (req, res) => {
  try {
    const { qualityEval, currentFeatures, featureStats } = req.body;
    
    if (!qualityEval) {
      return res.status(400).json({ error: "qualityEval이 필요합니다." });
    }
    
    const strategy = await requestFeatureStrategy(
      qualityEval,
      currentFeatures || [],
      featureStats || {}
    );
    
    res.json({
      success: true,
      data: strategy
    });
  } catch (error) {
    console.error("전략 요청 오류:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

