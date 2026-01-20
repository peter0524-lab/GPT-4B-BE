/**
 * Graph Builder
 * 관계 점수 기반으로 그래프 데이터 생성
 */

/**
 * Force-Directed Graph용 데이터 생성
 * @param {Array} relationshipScores - calculateAllRelationshipScores 결과의 scores
 * @param {Object} options - 옵션
 * @returns {Object} 노드와 엣지 데이터
 */
export function buildForceGraph(relationshipScores, options = {}) {
  const {
    centerNodeId = "user", // 중심 노드 (사용자)
    minScoreForEdge = 10,  // 엣지 표시 최소 점수
    maxNodes = 50,         // 최대 노드 수
  } = options;
  
  // 점수 상위 N개만 선택
  const topCards = relationshipScores.slice(0, maxNodes);
  
  // 노드 생성
  const nodes = [
    // 중심 노드 (사용자)
    {
      id: centerNodeId,
      label: "나",
      type: "user",
      size: 40,
      color: "#3b82f6",
      x: 0,
      y: 0,
      fixed: true
    }
  ];
  
  // 카드 노드들
  for (const card of topCards) {
    nodes.push({
      id: `card_${card.cardId}`,
      cardId: card.cardId,
      label: card.cardInfo?.name || `Card ${card.cardId}`,
      company: card.cardInfo?.company,
      position: card.cardInfo?.position,
      type: "contact",
      score: card.totalScore,
      grade: card.grade,
      rank: card.rank,
      size: mapScoreToSize(card.totalScore),
      color: card.grade.color,
    });
  }
  
  // 엣지 생성 (사용자와 각 카드 연결)
  const edges = [];
  for (const card of topCards) {
    if (card.totalScore < minScoreForEdge) continue;
    
    edges.push({
      source: centerNodeId,
      target: `card_${card.cardId}`,
      weight: card.totalScore,
      distance: mapScoreToDistance(card.totalScore),
      width: mapScoreToWidth(card.totalScore),
      color: card.grade.color,
      label: card.grade.label
    });
  }
  
  return {
    nodes,
    edges,
    metadata: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      scoreRange: {
        min: topCards[topCards.length - 1]?.totalScore || 0,
        max: topCards[0]?.totalScore || 0
      }
    }
  };
}

/**
 * 점수를 노드 크기로 매핑 (15~35)
 */
function mapScoreToSize(score) {
  return 15 + (score / 100) * 20;
}

/**
 * 점수를 거리로 매핑 (점수 높을수록 가까움)
 * 100~300 범위
 */
function mapScoreToDistance(score) {
  return 300 - (score / 100) * 200;
}

/**
 * 점수를 엣지 두께로 매핑 (1~5)
 */
function mapScoreToWidth(score) {
  return 1 + (score / 100) * 4;
}

/**
 * 클러스터링된 그래프 데이터 생성
 * 등급별로 그룹화
 */
export function buildClusteredGraph(relationshipScores) {
  const clusters = {
    A: { nodes: [], color: "#22c55e", label: "매우 친밀" },
    B: { nodes: [], color: "#84cc16", label: "친밀" },
    C: { nodes: [], color: "#eab308", label: "보통" },
    D: { nodes: [], color: "#f97316", label: "소원" },
    F: { nodes: [], color: "#ef4444", label: "거의 없음" }
  };
  
  for (const card of relationshipScores) {
    const grade = card.grade.level;
    clusters[grade].nodes.push({
      id: `card_${card.cardId}`,
      cardId: card.cardId,
      label: card.cardInfo?.name || `Card ${card.cardId}`,
      company: card.cardInfo?.company,
      score: card.totalScore,
      rank: card.rank
    });
  }
  
  return {
    clusters,
    summary: Object.entries(clusters).map(([grade, data]) => ({
      grade,
      label: data.label,
      color: data.color,
      count: data.nodes.length
    }))
  };
}

/**
 * 시계열 그래프용 데이터 생성
 * 관계 변화 추적용
 */
export function buildTimeSeriesData(relationshipScores, historicalData = []) {
  // 현재 스냅샷
  const currentSnapshot = {
    timestamp: new Date().toISOString(),
    scores: relationshipScores.map(s => ({
      cardId: s.cardId,
      score: s.totalScore,
      grade: s.grade.level
    }))
  };
  
  // 이전 데이터와 합치기
  const allSnapshots = [...historicalData, currentSnapshot];
  
  // 카드별 시계열 데이터
  const cardTimeSeries = {};
  for (const snapshot of allSnapshots) {
    for (const scoreData of snapshot.scores) {
      if (!cardTimeSeries[scoreData.cardId]) {
        cardTimeSeries[scoreData.cardId] = [];
      }
      cardTimeSeries[scoreData.cardId].push({
        timestamp: snapshot.timestamp,
        score: scoreData.score,
        grade: scoreData.grade
      });
    }
  }
  
  return {
    currentSnapshot,
    cardTimeSeries,
    snapshotCount: allSnapshots.length
  };
}

/**
 * 네트워크 통계 계산
 */
export function calculateNetworkStats(graphData) {
  const { nodes, edges } = graphData;
  
  // 연결 밀도
  const maxPossibleEdges = nodes.length * (nodes.length - 1) / 2;
  const density = maxPossibleEdges > 0 ? edges.length / maxPossibleEdges : 0;
  
  // 평균 엣지 가중치
  const avgWeight = edges.length > 0 
    ? edges.reduce((sum, e) => sum + e.weight, 0) / edges.length 
    : 0;
  
  // 등급별 분포
  const gradeDistribution = {};
  for (const node of nodes) {
    if (node.type === "contact" && node.grade) {
      const grade = node.grade.level;
      gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
    }
  }
  
  // 가장 강한 연결
  const strongestEdges = [...edges]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(e => {
      const targetNode = nodes.find(n => n.id === e.target);
      return {
        target: targetNode?.label || e.target,
        score: e.weight
      };
    });
  
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    density: Math.round(density * 1000) / 1000,
    avgConnectionStrength: Math.round(avgWeight * 100) / 100,
    gradeDistribution,
    strongestConnections: strongestEdges
  };
}

/**
 * D3.js Force Layout 시뮬레이션 파라미터 생성
 */
export function getD3ForceParams(graphData) {
  const nodeCount = graphData.nodes.length;
  
  return {
    // 척력 (노드 간 밀어내는 힘)
    chargeStrength: -300 - nodeCount * 5,
    
    // 링크 거리
    linkDistance: (d) => d.distance || 150,
    
    // 링크 강도
    linkStrength: (d) => (d.weight || 50) / 100,
    
    // 중심으로 당기는 힘
    centerStrength: 0.05,
    
    // 충돌 반경
    collisionRadius: (d) => (d.size || 20) + 10,
    
    // 감쇠
    velocityDecay: 0.4,
    
    // 시뮬레이션 반복 횟수
    iterations: 300
  };
}

/**
 * 그래프 데이터를 JSON 파일로 내보내기 형식으로 변환
 */
export function exportGraphData(graphData, format = "json") {
  if (format === "json") {
    return JSON.stringify(graphData, null, 2);
  }
  
  if (format === "csv") {
    // 노드 CSV
    const nodesCsv = [
      "id,label,type,score,grade,company",
      ...graphData.nodes.map(n => 
        `${n.id},"${n.label || ''}",${n.type},${n.score || ''},${n.grade?.level || ''},"${n.company || ''}"`
      )
    ].join("\n");
    
    // 엣지 CSV
    const edgesCsv = [
      "source,target,weight,label",
      ...graphData.edges.map(e => 
        `${e.source},${e.target},${e.weight},"${e.label || ''}"`
      )
    ].join("\n");
    
    return { nodesCsv, edgesCsv };
  }
  
  return graphData;
}


