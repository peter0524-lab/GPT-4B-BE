import { logger } from './logger.js';

// sharp를 lazy load (EC2 환경에서 실패할 수 있음)
let sharp = null;
let sharpLoadAttempted = false;

const loadSharp = async () => {
  if (sharpLoadAttempted) return sharp;
  sharpLoadAttempted = true;
  
  try {
    const sharpModule = await import('sharp');
    sharp = sharpModule.default;
    logger.info('sharp 모듈 로드 성공');
  } catch (error) {
    logger.warn('sharp 모듈 로드 실패 - 이미지 전처리 기능이 비활성화됩니다', error.message);
    sharp = null;
  }
  
  return sharp;
};

/**
 * 이미지 전처리 유틸리티
 * - 이미지 품질 검증
 * - 크기/해상도 최적화
 * - 회전/기울기 보정
 * - 명함 영역 감지 및 크롭
 */

// 최소/최대 이미지 크기 제한
const MIN_WIDTH = 200;
const MIN_HEIGHT = 200;
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;

// 최적 해상도 (OCR에 적합한 크기)
const OPTIMAL_WIDTH = 2000;
const OPTIMAL_HEIGHT = 2000;

// 최대 파일 크기 (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Base64 이미지를 Buffer로 변환
 */
const base64ToBuffer = (base64String) => {
  return Buffer.from(base64String, 'base64');
};

/**
 * Buffer를 Base64로 변환
 */
const bufferToBase64 = (buffer, mimeType = 'image/jpeg') => {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
};

/**
 * 이미지 품질 검증
 * @param {Buffer} imageBuffer - 이미지 버퍼
 * @returns {Promise<Object>} 검증 결과 및 메타데이터
 */
export const validateImage = async (imageBuffer) => {
  const sharpModule = await loadSharp();
  if (!sharpModule) {
    logger.warn('sharp 모듈이 없어 기본 검증만 수행합니다');
    return {
      isValid: imageBuffer.length <= MAX_FILE_SIZE,
      errors: imageBuffer.length > MAX_FILE_SIZE ? ['파일 크기가 너무 큽니다.'] : [],
      warnings: [],
      metadata: null,
    };
  }
  
  try {
    const metadata = await sharpModule(imageBuffer).metadata();
    
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: imageBuffer.length,
        hasAlpha: metadata.hasAlpha,
        orientation: metadata.orientation,
      },
    };

    // 크기 검증
    if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) {
      validation.isValid = false;
      validation.errors.push(
        `이미지 크기가 너무 작습니다. 최소 ${MIN_WIDTH}x${MIN_HEIGHT}px 이상이어야 합니다.`
      );
    }

    if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
      validation.warnings.push(
        `이미지 크기가 큽니다. 최적화를 위해 리사이즈됩니다.`
      );
    }

    // 파일 크기 검증
    if (imageBuffer.length > MAX_FILE_SIZE) {
      validation.isValid = false;
      validation.errors.push(
        `파일 크기가 너무 큽니다. 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 허용됩니다.`
      );
    }

    // 형식 검증
    const supportedFormats = ['jpeg', 'jpg', 'png', 'webp'];
    if (!supportedFormats.includes(metadata.format)) {
      validation.warnings.push(
        `지원되지 않는 이미지 형식입니다. JPEG/PNG 형식으로 변환됩니다.`
      );
    }

    logger.debug('이미지 검증 완료', validation);

    return validation;
  } catch (error) {
    logger.error('이미지 검증 실패', error);
    return {
      isValid: false,
      errors: ['이미지를 읽을 수 없습니다. 유효한 이미지 파일인지 확인해주세요.'],
      warnings: [],
      metadata: null,
    };
  }
};

/**
 * 이미지 크기/해상도 최적화
 * @param {Buffer} imageBuffer - 원본 이미지 버퍼
 * @param {Object} options - 최적화 옵션
 * @returns {Promise<Buffer>} 최적화된 이미지 버퍼
 */
export const optimizeImage = async (imageBuffer, options = {}) => {
  const sharpModule = await loadSharp();
  if (!sharpModule) {
    logger.warn('sharp 모듈이 없어 원본 이미지를 반환합니다');
    return imageBuffer;
  }
  
  try {
    const {
      maxWidth = OPTIMAL_WIDTH,
      maxHeight = OPTIMAL_HEIGHT,
      quality = 90,
      format = 'jpeg',
    } = options;

    let pipeline = sharpModule(imageBuffer);

    // 메타데이터 확인
    const metadata = await pipeline.metadata();
    const { width, height } = metadata;

    // 리사이즈 필요 여부 확인
    const needsResize = width > maxWidth || height > maxHeight;
    
    if (needsResize) {
      // 비율 유지하며 리사이즈
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      logger.debug('이미지 리사이즈', {
        원본크기: `${width}x${height}`,
        최적크기: `${maxWidth}x${maxHeight}`,
      });
    }

    // 형식 변환 및 품질 최적화
    if (format === 'jpeg') {
      pipeline = pipeline.jpeg({
        quality,
        mozjpeg: true, // 최적화된 JPEG 인코딩
      });
    } else if (format === 'png') {
      pipeline = pipeline.png({
        quality,
        compressionLevel: 9,
      });
    } else if (format === 'webp') {
      pipeline = pipeline.webp({
        quality,
      });
    }

    const optimizedBuffer = await pipeline.toBuffer();
    
    logger.debug('이미지 최적화 완료', {
      원본크기: `${imageBuffer.length} bytes`,
      최적화크기: `${optimizedBuffer.length} bytes`,
      압축률: `${((1 - optimizedBuffer.length / imageBuffer.length) * 100).toFixed(1)}%`,
    });

    return optimizedBuffer;
  } catch (error) {
    logger.error('이미지 최적화 실패', error);
    throw new Error('이미지 최적화에 실패했습니다.');
  }
};

/**
 * 이미지 회전 보정 (EXIF orientation 정보 기반)
 * @param {Buffer} imageBuffer - 원본 이미지 버퍼
 * @returns {Promise<Buffer>} 보정된 이미지 버퍼
 */
export const correctRotation = async (imageBuffer) => {
  const sharpModule = await loadSharp();
  if (!sharpModule) return imageBuffer;
  
  try {
    const metadata = await sharpModule(imageBuffer).metadata();
    
    // EXIF orientation이 있으면 자동 회전
    if (metadata.orientation && metadata.orientation > 1) {
      logger.debug('이미지 회전 보정', { orientation: metadata.orientation });
      return await sharpModule(imageBuffer)
        .rotate() // EXIF orientation에 따라 자동 회전
        .toBuffer();
    }

    return imageBuffer;
  } catch (error) {
    logger.error('이미지 회전 보정 실패', error);
    return imageBuffer; // 실패 시 원본 반환
  }
};

/**
 * 간단한 기울기 보정 (명함의 가장자리를 찾아서 보정)
 * @param {Buffer} imageBuffer - 원본 이미지 버퍼
 * @returns {Promise<Buffer>} 보정된 이미지 버퍼
 */
export const correctSkew = async (imageBuffer) => {
  const sharpModule = await loadSharp();
  if (!sharpModule) return imageBuffer;
  
  try {
    // Sharp는 직접적인 기울기 보정을 지원하지 않으므로
    // Google Vision API의 DOCUMENT_TEXT_DETECTION을 사용하거나
    // OpenCV 같은 라이브러리가 필요합니다.
    // 여기서는 기본적인 선명화(sharpening)만 적용
    
    const sharpened = await sharpModule(imageBuffer)
      .sharpen({
        sigma: 1,
        flat: 1,
        jagged: 2,
      })
      .normalize() // 명암 대비 개선
      .toBuffer();

    logger.debug('이미지 선명화 적용');
    return sharpened;
  } catch (error) {
    logger.error('이미지 기울기 보정 실패', error);
    return imageBuffer;
  }
};

/**
 * 명함 영역 감지 및 크롭 (간단한 버전)
 * Google Vision API의 DOCUMENT_TEXT_DETECTION을 사용하는 것이 더 정확하지만,
 * 여기서는 이미지의 중앙 영역을 명함으로 가정하고 크롭
 * @param {Buffer} imageBuffer - 원본 이미지 버퍼
 * @param {Object} options - 크롭 옵션
 * @returns {Promise<Buffer>} 크롭된 이미지 버퍼
 */
export const detectAndCropCard = async (imageBuffer, options = {}) => {
  const sharpModule = await loadSharp();
  if (!sharpModule) return imageBuffer;
  
  try {
    const {
      cropRatio = 0.8, // 중앙 80% 영역 크롭
      minAspectRatio = 0.5, // 최소 가로:세로 비율
      maxAspectRatio = 2.0, // 최대 가로:세로 비율
    } = options;

    const metadata = await sharpModule(imageBuffer).metadata();
    const { width, height } = metadata;

    // 현재 비율 확인
    const aspectRatio = width / height;
    
    // 비율이 명함에 적합한지 확인
    if (aspectRatio < minAspectRatio || aspectRatio > maxAspectRatio) {
      logger.warn('이미지 비율이 명함에 적합하지 않습니다', { aspectRatio });
      // 비율이 맞지 않으면 전체 이미지 사용
      return imageBuffer;
    }

    // 중앙 영역 계산
    const cropWidth = Math.floor(width * cropRatio);
    const cropHeight = Math.floor(height * cropRatio);
    const left = Math.floor((width - cropWidth) / 2);
    const top = Math.floor((height - cropHeight) / 2);

    const cropped = await sharpModule(imageBuffer)
      .extract({
        left,
        top,
        width: cropWidth,
        height: cropHeight,
      })
      .toBuffer();

    logger.debug('명함 영역 크롭 완료', {
      원본크기: `${width}x${height}`,
      크롭크기: `${cropWidth}x${cropHeight}`,
      위치: `(${left}, ${top})`,
    });

    return cropped;
  } catch (error) {
    logger.error('명함 영역 크롭 실패', error);
    return imageBuffer; // 실패 시 원본 반환
  }
};

/**
 * 종합 이미지 전처리
 * @param {string} base64Image - Base64 인코딩된 이미지
 * @returns {Promise<string>} 전처리된 Base64 이미지
 */
export const preprocessImage = async (base64Image) => {
  try {
    logger.debug('이미지 전처리 시작');

    // Base64에서 data URL prefix 제거
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = base64ToBuffer(base64Data);

    // 1. 이미지 품질 검증
    const validation = await validateImage(imageBuffer);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }

    // 2. 회전 보정
    let processedBuffer = await correctRotation(imageBuffer);

    // 3. 명함 영역 크롭 (선택적)
    // 실제로는 Google Vision API의 DOCUMENT_TEXT_DETECTION을 사용하는 것이 더 정확
    // processedBuffer = await detectAndCropCard(processedBuffer);

    // 4. 크기/해상도 최적화
    processedBuffer = await optimizeImage(processedBuffer, {
      maxWidth: OPTIMAL_WIDTH,
      maxHeight: OPTIMAL_HEIGHT,
      quality: 90,
      format: 'jpeg',
    });

    // 5. 기울기 보정 (선명화)
    processedBuffer = await correctSkew(processedBuffer);

    // Base64로 변환
    const processedBase64 = bufferToBase64(processedBuffer, 'image/jpeg');

    logger.debug('이미지 전처리 완료', {
      원본크기: `${imageBuffer.length} bytes`,
      처리후크기: `${processedBuffer.length} bytes`,
    });

    return processedBase64;
  } catch (error) {
    logger.error('이미지 전처리 실패', error);
    // 전처리 실패 시 원본 반환
    return base64Image;
  }
};

/**
 * Google Vision API를 사용한 고급 명함 영역 감지
 * @param {string} base64Data - Base64 인코딩된 이미지 (prefix 제거된 순수 base64)
 * @param {string} apiKey - Google Cloud Vision API 키
 * @returns {Promise<Object|null>} 명함 영역 좌표 또는 null
 */
export const detectCardRegionWithVisionAPI = async (base64Data, apiKey) => {
  try {
    const axios = (await import('axios')).default;
    
    const response = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        requests: [
          {
            image: {
              content: base64Data,
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION',
                maxResults: 1,
              },
            ],
          },
        ],
      }
    );

    const textAnnotations = response.data.responses[0]?.textAnnotations;
    if (!textAnnotations || textAnnotations.length === 0) {
      return null;
    }

    // 첫 번째 annotation이 전체 텍스트 영역
    const boundingPoly = textAnnotations[0].boundingPoly;
    if (boundingPoly && boundingPoly.vertices) {
      const vertices = boundingPoly.vertices;
      const xCoords = vertices.map(v => v.x).filter(x => x !== undefined);
      const yCoords = vertices.map(v => v.y).filter(y => y !== undefined);

      if (xCoords.length > 0 && yCoords.length > 0) {
        return {
          left: Math.min(...xCoords),
          top: Math.min(...yCoords),
          width: Math.max(...xCoords) - Math.min(...xCoords),
          height: Math.max(...yCoords) - Math.min(...yCoords),
        };
      }
    }

    return null;
  } catch (error) {
    logger.error('Vision API 명함 영역 감지 실패', error);
    return null;
  }
};

export default {
  validateImage,
  optimizeImage,
  correctRotation,
  correctSkew,
  detectAndCropCard,
  preprocessImage,
  detectCardRegionWithVisionAPI,
};
