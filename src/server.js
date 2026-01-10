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

// Middleware
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";

// Database
import { testConnection, createTables } from "./config/database.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());

// CORS 설정 - 개발 환경에서는 더 유연하게 설정
const corsOptions = {
  origin: function (origin, callback) {
    // 개발 환경에서는 모든 origin 허용 (모바일 테스트용)
    if (process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      // 프로덕션에서는 지정된 origin만 허용
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:5174",
      ].filter(Boolean);
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
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

// Error handling
app.use(notFound);
app.use(errorHandler);

// Database connection and initialization
const initializeDatabase = async () => {
  const isConnected = await testConnection();
  if (!isConnected) {
    console.error("❌ Failed to connect to database");
    process.exit(1);
  }

  // Create tables if they don't exist
  await createTables();

  // Start server - 0.0.0.0으로 바인딩하여 외부 접속 허용
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`🌐 Server accessible from: http://0.0.0.0:${PORT}`);
    console.log(`💡 Local access: http://localhost:${PORT}`);
    console.log(`📱 Network access: http://<your-ip>:${PORT}`);
  });
};

initializeDatabase().catch((error) => {
  console.error("❌ Database initialization error:", error);
  process.exit(1);
});

export default app;
