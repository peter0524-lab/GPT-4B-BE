import { logger } from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  logger.error('Error handler', err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid ID format'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // 응답이 이미 전송되었는지 확인
  if (res.headersSent) {
    return next(err);
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const errorResponse = {
    success: false,
    message: err.message || 'Server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };

  try {
    res.status(statusCode).json(errorResponse);
  } catch (sendError) {
    logger.error('Failed to send error response', sendError);
    // 최후의 수단: 텍스트 응답
    if (!res.headersSent) {
      res.status(statusCode).send(JSON.stringify(errorResponse));
    }
  }
};

