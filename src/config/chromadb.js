import { ChromaClient } from "chromadb";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

// ChromaDB 클라이언트 초기화
const chromaClient = new ChromaClient({
  path: process.env.CHROMADB_PATH || "http://localhost:8000",
});

// 컬렉션 이름
const COLLECTION_NAME = "gift_embeddings";

// ChromaDB 연결 테스트
const testConnection = async () => {
  try {
    await chromaClient.heartbeat();
    logger.info("ChromaDB connected successfully");
    return true;
  } catch (error) {
    logger.error("ChromaDB connection error", error);
    return false;
  }
};

// 컬렉션 가져오기 또는 생성
const getOrCreateCollection = async () => {
  try {
    // 기존 컬렉션이 있는지 확인
    const collections = await chromaClient.listCollections();
    const existingCollection = collections.find(
      (col) => col.name === COLLECTION_NAME
    );

    if (existingCollection) {
      return await chromaClient.getCollection({ name: COLLECTION_NAME });
    }

    // 컬렉션이 없으면 생성. 동시 요청으로 이미 생성된 경우를 대비해 처리.
    try {
      return await chromaClient.createCollection({
        name: COLLECTION_NAME,
        metadata: {
          description: "선물 정보 임베딩 데이터",
        },
      });
    } catch (error) {
      if (
        error?.message &&
        (error.message.includes("already exists") ||
          error.message.includes("resource already exists"))
      ) {
        // race condition: 이미 생성되었으므로 가져오기
        return await chromaClient.getCollection({ name: COLLECTION_NAME });
      }
      throw error;
    }
  } catch (error) {
    logger.error("Error getting/creating collection", error);
    throw error;
  }
};

export { chromaClient, COLLECTION_NAME, testConnection, getOrCreateCollection };
export default chromaClient;

