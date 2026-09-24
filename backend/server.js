const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const connectDB = require("./config/db");

const incidentRoutes = require("./routes/incidentRoutes");
const weatherRoutes = require("./routes/weatherRoutes");
const rainfallRoutes = require("./routes/rainfallRoutes");
const terrainRoutes = require("./routes/terrainRoutes");
const geoRoutes = require("./routes/geoRoutes");
const slopeRoutes = require("./routes/slopeRoutes");
const authRoutes = require("./routes/authRoutes");
const riskRoutes = require("./routes/riskRoutes");
const safetyRoutes = require("./routes/safetyRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const historyRoutes = require("./routes/historyRoutes");
const alertRoutes = require("./routes/alertRoutes");
const routeRoutes = require("./routes/routeRoutes");
const smsWebhookRoutes = require("./routes/smsWebhookRoutes");
const intelligenceRoutes = require("./routes/intelligenceRoutes");
const riskHistoryRoutes = require("./routes/riskHistoryRoutes");
const demoCitizenRoutes = require("./routes/demoCitizenRoutes");
const responseRoutes = require("./routes/responseRoutes");
const app = express();

// ===============================
// CORS allowlist
// ===============================
// Previously `cors()` with no options == reflect any Origin, i.e. any
// website can call this API from a browser. ALLOWED_ORIGINS in .env
// is a comma-separated list; if it's unset we fall back to allowing
// everything so local/dev setups that haven't configured it yet don't
// just break — but that fallback is logged loudly on boot so it isn't
// silently left open in a real deployment.
const configuredOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions = configuredOrigins.length
    ? {
          origin: (origin, callback) => {
              // Allow no-Origin requests (curl, server-to-server, some
              // mobile webviews) and anything on the allowlist.
              if (!origin || configuredOrigins.includes(origin)) {
                  return callback(null, true);
              }
              return callback(new Error(`Origin ${origin} not allowed by CORS`));
          }
      }
    : {};

if (!configuredOrigins.length) {
    console.warn(
        "[server] ALLOWED_ORIGINS not set — CORS is open to any origin. " +
        "Set ALLOWED_ORIGINS in .env before a real deployment."
    );
}
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        message: "Too many requests. Please try again later."
    }
});

// ===============================
// Middleware
// ===============================
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio's webhook posts form-encoded, not JSON
app.use("/api", apiLimiter);

// Serve uploaded hazard-report evidence files.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));



// ===============================
// Connect MongoDB
// ===============================

connectDB();

// NOTE: this was defined but never actually imported anywhere before,
// so the cron job inside it was never running. Requiring it here for
// its side effect (registering the cron schedule) starts it.
require("./scheduler/weatherScheduler");


// ===============================
// API Routes
// ===============================

app.use("/api/incidents", incidentRoutes);
app.use("/api/weather", weatherRoutes);

app.use("/api/rainfall", rainfallRoutes);
app.use("/api/terrain", terrainRoutes);
app.use("/api/geo", geoRoutes);
app.use("/api/slope", slopeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/risk", riskRoutes);
app.use("/api/safety", safetyRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/route", routeRoutes);
app.use("/api/sms", smsWebhookRoutes);
app.use("/api/intelligence", intelligenceRoutes);
app.use("/api/risk-history", riskHistoryRoutes);
app.use("/api/demo", demoCitizenRoutes);
app.use("/api/response", responseRoutes);


// ===============================
// Home Route
// ===============================

app.get("/", (req, res) => {
    res.status(200).json({
        message: "NER Sentinel Backend is running"
    });
});


// ===============================
// Server Port
// ===============================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`NER Sentinel Backend running on port ${PORT}`);
});
