import axios from 'axios';
import { logger } from '../utils/logger.js';
import { 
  preprocessImage, 
  detectCardRegionWithVisionAPI 
} from '../utils/imagePreprocessor.js';
// sharp를 lazy load
let sharp = null;
let sharpLoadAttempted = false;

const loadSharp = async () => {
  if (sharpLoadAttempted) return sharp;
  sharpLoadAttempted = true;
  
  try {
    const sharpModule = await import('sharp');
    sharp = sharpModule.default;
  } catch (error) {
    // sharp가 없어도 OCR은 동작 가능 (Google Vision API 사용)
    sharp = null;
  }
  
  return sharp;
};
import { processLLMChat } from './llm.service.js';

/**
 * Process OCR from base64 image
 * @param {string} base64Image - Base64 encoded image string
 * @returns {Promise<Object>} OCR result with extracted fields
 */
export const processOCR = async (base64Image) => {
  try {
    logger.debug('OCR 처리 시작');

    // 이미지 전처리 (품질 검증, 최적화, 회전 보정)
    let processedImage = base64Image;
    try {
      processedImage = await preprocessImage(base64Image);
      logger.debug('이미지 전처리 완료');
    } catch (preprocessError) {
      logger.warn('이미지 전처리 실패, 원본 이미지 사용', preprocessError);
      // 전처리 실패해도 원본으로 계속 진행
    }

    // Remove data URL prefix if present
    const base64Data = processedImage.replace(/^data:image\/\w+;base64,/, '');

    // Option 1: Google Cloud Vision API
    if (process.env.GOOGLE_CLOUD_VISION_API_KEY) {
      return await processWithGoogleVision(base64Data);
    }

    // Option 2: Tesseract.js (client-side processing)
    // Option 3: Other OCR services (AWS Textract, Azure Computer Vision, etc.)

    // Fallback: Mock response for development
    return mockOCRResponse();
  } catch (error) {
    logger.error('OCR Service Error', error);
    throw new Error('OCR processing failed');
  }
};

/**
 * Process OCR using Google Cloud Vision API
 */
const processWithGoogleVision = async (base64Data) => {
  try {
    const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    
    // 1. 명함 영역 감지 시도 (DOCUMENT_TEXT_DETECTION 사용)
    let processedBase64Data = base64Data;
    try {
      const cardRegion = await detectCardRegionWithVisionAPI(base64Data, apiKey);
      if (cardRegion) {
        logger.debug('명함 영역 감지 성공', cardRegion);
        
        // 감지된 영역으로 이미지 크롭
        const sharpModule = await loadSharp();
        if (sharpModule) {
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const croppedBuffer = await sharpModule(imageBuffer)
            .extract({
              left: Math.max(0, cardRegion.left),
              top: Math.max(0, cardRegion.top),
              width: cardRegion.width,
              height: cardRegion.height,
            })
            .toBuffer();
          
          processedBase64Data = croppedBuffer.toString('base64');
          logger.debug('명함 영역 크롭 완료');
        } else {
          logger.warn('sharp 모듈이 없어 명함 영역 크롭을 건너뜁니다');
        }
      }
    } catch (regionError) {
      logger.warn('명함 영역 감지 실패, 전체 이미지 사용', regionError);
      // 영역 감지 실패 시 전체 이미지 사용
    }

    // 2. OCR 수행
    const response = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        requests: [
          {
            image: {
              content: processedBase64Data
            },
            features: [
              {
                type: 'TEXT_DETECTION',
                maxResults: 1
              }
            ]
          }
        ]
      }
    );

    const textAnnotations = response.data.responses[0]?.textAnnotations;
    if (!textAnnotations || textAnnotations.length === 0) {
      return mockOCRResponse();
    }

    // Parse text to extract business card information
    const fullText = textAnnotations[0].description;
    return await parseBusinessCardText(fullText);
  } catch (error) {
    logger.error('Google Vision API Error', error);
    // Fallback to mock
    return mockOCRResponse();
  }
};

/**
 * Parse OCR text using GPT to extract business card fields
 * GPT를 사용하여 명함 정보를 추출합니다
 */
const parseBusinessCardTextWithGPT = async (text) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      logger.debug('GPT 파싱: OPENAI_API_KEY가 없어 정규식 파싱으로 폴백');
      return null;
    }

    logger.debug('🤖 [GPT OCR 파싱 시작]');
    
    const prompt = `당신은 명함 텍스트에서 정보를 추출하는 전문가입니다. 아래 텍스트를 분석하여 명함 정보를 JSON 형식으로 추출해주세요.

텍스트:
"""
${text}
"""

다음 필드들을 추출해주세요:
- name: 이름 (한글 2-4글자 또는 영문 이름)
- position: 직책 (부장, 대표이사, Manager, CEO 등)
- company: 회사명
- phone: 전화번호 (010-1234-5678 형식)
- email: 이메일 주소
- memo: 기타 메모 정보

응답은 반드시 다음 JSON 형식으로만 반환해주세요 (다른 설명 없이):
{
  "name": "이름 또는 null",
  "position": "직책 또는 null",
  "company": "회사명 또는 null",
  "phone": "전화번호 또는 null",
  "email": "이메일 또는 null",
  "memo": "메모 또는 null"
}

값이 없으면 null을 사용하고, 빈 문자열 대신 null을 반환하세요.`;

    const messages = [
      {
        role: 'system',
        content: '당신은 명함 텍스트 분석 전문가입니다. 주어진 텍스트에서 명함 정보를 정확하게 추출하여 JSON 형식으로 반환합니다.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    const gptResponse = await processLLMChat(messages, 'gpt');
    
    // JSON 추출 (응답에 마크다운 코드 블록이 있을 수 있음)
    let jsonStr = gptResponse.trim();
    
    // ```json 또는 ``` 코드 블록 제거
    jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // JSON 파싱
    const parsedData = JSON.parse(jsonStr);
    
    // 결과 형식 맞추기
    const result = {
      rawText: text,
      name: parsedData.name && parsedData.name !== 'null' ? parsedData.name : undefined,
      position: parsedData.position && parsedData.position !== 'null' ? parsedData.position : undefined,
      company: parsedData.company && parsedData.company !== 'null' ? parsedData.company : undefined,
      phone: parsedData.phone && parsedData.phone !== 'null' ? parsedData.phone : undefined,
      email: parsedData.email && parsedData.email !== 'null' ? parsedData.email : undefined,
      memo: parsedData.memo && parsedData.memo !== 'null' ? parsedData.memo : undefined,
    };

    logger.debug('✅ [GPT OCR 파싱 완료]', {
      이름: result.name || '(없음)',
      직책: result.position || '(없음)',
      회사: result.company || '(없음)',
      전화: result.phone || '(없음)',
      이메일: result.email || '(없음)',
      메모: result.memo || '(없음)',
    });

    return result;
  } catch (error) {
    logger.warn('GPT OCR 파싱 실패, 정규식 파싱으로 폴백', error);
    return null;
  }
};

/**
 * Parse OCR text to extract business card fields
 * GPT를 우선 시도하고, 실패 시 정규식 기반 파싱으로 폴백
 */
const parseBusinessCardText = async (text) => {
  if (!text || text.trim() === '') {
    logger.warn('OCR 파싱: 텍스트가 비어있습니다');
    return {
      rawText: text,
      name: undefined,
      position: undefined,
      company: undefined,
      phone: undefined,
      email: undefined,
      memo: undefined,
    };
  }

  // 1. GPT 파싱 시도
  try {
    const gptResult = await parseBusinessCardTextWithGPT(text);
    if (gptResult) {
      return gptResult;
    }
  } catch (error) {
    logger.warn('GPT 파싱 시도 중 오류 발생, 정규식 파싱으로 폴백', error);
  }

  // 2. 폴백: 정규식 기반 파싱 (기존 로직)
  logger.debug('📝 [정규식 OCR 파싱 시작]');
  
  // rawText 추가
  const result = {
    rawText: text,
    name: '',
    position: '',
    company: '',
    phone: '',
    email: '',
    memo: '',
  };

  const lines = text.split(/\r?\n/).filter(line => line.trim());
  logger.debug('OCR 파싱 시작', { 
    텍스트길이: text.length, 
    라인수: lines.length 
  });

  // 1) 이메일 추출
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
  const emailMatch = text.match(emailRegex);
  if (emailMatch) {
    result.email = emailMatch[0];
    logger.debug('이메일 추출 성공', { email: result.email });
  }

  // 2) 전화번호 추출 (다양한 형식 지원)
  const phoneRegex = /(\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{4})/g;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) {
    result.phone = phoneMatch[0];
    logger.debug('전화번호 추출 성공', { phone: result.phone });
  }

  // 3) 이름 추출 (첫 번째 라인이 보통 이름)
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    // 이메일이나 전화번호가 포함된 라인은 제외
    if (!result.email || !firstLine.includes(result.email)) {
      if (!result.phone || !firstLine.includes(result.phone)) {
        result.name = firstLine;
      }
    }
  }

  // 4) 직책 추출 (키워드 매칭)
  const titleKeywords = [
    '대표이사', '대표', '이사', '전무', '상무', '부장', '차장', '과장',
    '대리', '주임', '사원', '팀장', '실장', '센터장', '원장',
    'Manager', 'Director', 'Lead', 'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'Head',
    'Brand Strategist', 'AI Researcher', 'Product Designer',
    'Senior', 'Junior', 'Principal', 'Staff', 'Associate',
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 이미 이름으로 사용된 라인은 제외
    if (result.name && line === result.name) continue;
    // 이메일/전화번호 포함 라인 제외
    if (result.email && line.includes(result.email)) continue;
    if (result.phone && line.includes(result.phone)) continue;

    // 키워드로 직책 찾기
    const found = titleKeywords.find(k => line.includes(k));
    if (found) {
      result.position = line;
      // 이름이 아직 없고 직책 라인에서 이름 추출 가능하면
      if (!result.name || result.name === lines[0].trim()) {
        const nameCandidate = line.replace(found, '').trim();
        if (nameCandidate && nameCandidate.length > 0) {
          result.name = nameCandidate;
        }
      }
      logger.debug('직책 추출 성공', { position: result.position });
      break;
    }
  }

  // 두 번째 라인이 직책일 수도 있음
  if (!result.position && lines.length > 1) {
    const secondLine = lines[1].trim();
    if ((!result.email || !secondLine.includes(result.email)) &&
        (!result.phone || !secondLine.includes(result.phone))) {
      result.position = secondLine;
    }
  }

  // 이름이 아직 없으면 한글 2~4글자 라인 찾기
  if (!result.name || result.name === '') {
    for (const line of lines) {
      const cleanLine = line.replace(/\s/g, '');
      if (/^[가-힣]{2,4}$/.test(cleanLine)) {
        result.name = cleanLine;
        logger.debug('한글 이름 패턴 인식 성공', { name: result.name });
        break;
      }
    }
  }

  // 5) 회사명 추출 (확장된 마커)
  const companyMarkers = [
    'co', 'ltd', 'inc', 'corp', '회사', '주식회사',
    'Co.', 'Inc.', 'Corporation', 'Corp.', 'Ltd',
    '(주)', '유한회사', '㈜', '주식회사',
    'Group', 'Company', 'Enterprises', 'Solutions', 'Systems',
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (companyMarkers.some(marker => line.includes(marker.toLowerCase()))) {
      result.company = lines[i].trim();
      logger.debug('회사명 추출 성공 (마커)', { company: result.company });
      break;
    }
  }

  // 회사명을 못 찾았으면 첫 번째 또는 세 번째 라인 사용
  if (!result.company || result.company === '') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // 이미 사용된 필드 제외
      if (result.name && line === result.name) continue;
      if (result.position && line === result.position) continue;
      if (result.email && line.includes(result.email)) continue;
      if (result.phone && line.includes(result.phone)) continue;
      
      result.company = line;
      logger.debug('회사명 추출 성공 (폴백)', { company: result.company });
      break;
    }
  }

  // 6) 메모용 기타 텍스트
  const memoLines = lines.filter(line => {
    const trimmed = line.trim();
    if (result.name && trimmed.includes(result.name)) return false;
    if (result.position && trimmed === result.position) return false;
    if (result.company && trimmed === result.company) return false;
    if (result.email && trimmed.includes(result.email)) return false;
    if (result.phone && trimmed.includes(result.phone)) return false;
    return true;
  });

  if (memoLines.length > 0) {
    result.memo = memoLines.join('\n');
  }

  // 빈 문자열을 undefined로 변환 (프론트엔드와 일관성 유지)
  const parsedResult = {
    rawText: result.rawText,
    name: result.name || undefined,
    position: result.position || undefined,
    company: result.company || undefined,
    phone: result.phone || undefined,
    email: result.email || undefined,
    memo: result.memo || undefined,
  };

  logger.debug('📝 [정규식 OCR 파싱 완료]', {
    이름: parsedResult.name || '(없음)',
    직책: parsedResult.position || '(없음)',
    회사: parsedResult.company || '(없음)',
    전화: parsedResult.phone || '(없음)',
    이메일: parsedResult.email || '(없음)',
    메모: parsedResult.memo || '(없음)',
  });

  return parsedResult;
};

/**
 * Mock OCR response for development
 */
const mockOCRResponse = () => {
  const mockResponses = [
    {
      rawText: "박소윤\nBrand Strategist\nLuna Collective\n010-1234-5678\nsoyoon@luna.co",
      name: "박소윤",
      position: "Brand Strategist",
      company: "Luna Collective",
      phone: "010-1234-5678",
      email: "soyoon@luna.co",
    },
    {
      rawText: "이도현\nAI Researcher\nNova Labs\n010-8765-4321\ndohyun@nova.ai",
      name: "이도현",
      position: "AI Researcher",
      company: "Nova Labs",
      phone: "010-8765-4321",
      email: "dohyun@nova.ai",
    },
    {
      rawText: "최하늘\nProduct Designer\nOrbit Studio\n010-2345-6789\nha-neul@orbit.studio",
      name: "최하늘",
      position: "Product Designer",
      company: "Orbit Studio",
      phone: "010-2345-6789",
      email: "ha-neul@orbit.studio",
    },
  ];

  return mockResponses[Math.floor(Math.random() * mockResponses.length)];
};

