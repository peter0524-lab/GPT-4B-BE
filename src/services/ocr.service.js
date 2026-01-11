import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * Process OCR from base64 image
 * @param {string} base64Image - Base64 encoded image string
 * @returns {Promise<Object>} OCR result with extracted fields
 */
export const processOCR = async (base64Image) => {
  try {
    // Remove data URL prefix if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

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
    const response = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_CLOUD_VISION_API_KEY}`,
      {
        requests: [
          {
            image: {
              content: base64Data
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
    return parseBusinessCardText(fullText);
  } catch (error) {
    console.error('Google Vision API Error:', error);
    // Fallback to mock
    return mockOCRResponse();
  }
};

/**
 * Parse OCR text to extract business card fields
 */
const parseBusinessCardText = (text) => {
  const lines = text.split('\n').filter(line => line.trim());
  
  // Simple parsing logic (can be improved with ML/NLP)
  const result = {
    name: '',
    position: '',
    company: '',
    phone: '',
    email: '',
    memo: '',
  };

  // Extract email
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/;
  const emailMatch = text.match(emailRegex);
  if (emailMatch) {
    result.email = emailMatch[0];
  }

  // Extract phone (various formats)
  const phoneRegex = /(\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{4})/g;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) {
    result.phone = phoneMatch[0];
  }

  // First line is usually name
  if (lines.length > 0) {
    result.name = lines[0].trim();
  }

  // Second line might be position
  if (lines.length > 1) {
    result.position = lines[1].trim();
  }

  // Company name might be in various positions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    if (line.includes('co') || line.includes('ltd') || line.includes('inc') || 
        line.includes('corp') || line.includes('회사') || line.includes('주식회사')) {
      result.company = lines[i].trim();
      break;
    }
  }

  return result;
};

/**
 * Mock OCR response for development
 */
const mockOCRResponse = () => {
  const mockResponses = [
    {
      name: "박소윤",
      position: "Brand Strategist",
      company: "Luna Collective",
      phone: "010-1234-5678",
      email: "soyoon@luna.co",
    },
    {
      name: "이도현",
      position: "AI Researcher",
      company: "Nova Labs",
      phone: "010-8765-4321",
      email: "dohyun@nova.ai",
    },
    {
      name: "최하늘",
      position: "Product Designer",
      company: "Orbit Studio",
      phone: "010-2345-6789",
      email: "ha-neul@orbit.studio",
    },
  ];

  return mockResponses[Math.floor(Math.random() * mockResponses.length)];
};

