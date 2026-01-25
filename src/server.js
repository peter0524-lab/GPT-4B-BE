import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

// Routes
import authRoutes from "./routes/auth.routes.js";
import cardRoutes from "./routes/card.routes.js";
import ocrRoutes from "./routes/ocr.routes.js";
import giftRoutes from "./routes/gift.routes.js";
import calendarRoutes from "./routes/calendar.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import userRoutes from "./routes/user.routes.js";
import memoRoutes from "./routes/memo.routes.js";
import preferenceRoutes from "./routes/preference.routes.js";
import extractedFactRoutes from "./routes/extractedFact.routes.js";
import sourceEventRoutes from "./routes/sourceEvent.routes.js";
import relationshipSummaryRoutes from "./routes/relationshipSummary.routes.js";
import cardSearchRoutes from "./routes/cardSearch.routes.js";
import groupRoutes from "./routes/group.routes.js";
import graphRoutes from "./routes/graph.routes.js";

// Middleware
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { logger } from "./utils/logger.js";

// Database
import { testConnection, createTables } from "./config/database.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());

// CORS 설정 - Capacitor 및 웹 origin 허용
const corsOptions = {
  origin: function (origin, callback) {
    // 프로덕션에서 허용할 origin 목록
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "https://main.d2eqy2d76d9t0m.amplifyapp.com",
      "https://d3gv58ggenyxb5.cloudfront.net",
      // Capacitor origins (모바일 앱)
      "capacitor://localhost",
      "ionic://localhost",
      "http://localhost",
      // 개발용
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:5174",
      ].filter(Boolean);
      
    // origin이 없는 경우 (same-origin 요청, Postman 등) 또는 허용 목록에 있는 경우
      if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 개발 환경에서는 모든 origin 허용
      if (process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        console.log('CORS blocked origin:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "GPT-4b Backend API is running" });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/cards", cardRoutes);
app.use("/api/ocr", ocrRoutes);
app.use("/api/gifts", giftRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/users", userRoutes);
app.use("/api/memo", memoRoutes);
app.use("/api/profile", preferenceRoutes);
app.use("/api/extracted-facts", extractedFactRoutes);
app.use("/api/source-events", sourceEventRoutes);
app.use("/api/relationship-summary", relationshipSummaryRoutes);
app.use("/api/card-search", cardSearchRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/graph", graphRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Database connection and initialization
const initializeDatabase = async () => {
  const isConnected = await testConnection();
  if (!isConnected) {
    logger.error("Failed to connect to database");
    process.exit(1);
  }

  // Create tables if they don't exist
  await createTables();

  // Start server - 0.0.0.0으로 바인딩하여 외부 접속 허용
  app.listen(PORT, '0.0.0.0', () => {
    logger.info("Server is running", {
      port: PORT,
      environment: process.env.NODE_ENV || "development",
      localAccess: `http://localhost:${PORT}`,
      networkAccess: `http://0.0.0.0:${PORT}`,
    });
  });
};

initializeDatabase().catch((error) => {
  logger.error("Database initialization error", error);
  process.exit(1);
});

export default app;
