require('dotenv').config({ override: true });
const express = require('express');
const { testConnection } = require('./config/db');
const routes = require('./routes/routes');
const SystemController = require('./controllers/systemController');

const app = express();
const PORT = process.env.PORT || 5000;
// Bind to 0.0.0.0 so server accepts requests on any host IP (e.g. 147.93.105.85)
const HOST = process.env.HOST || '0.0.0.0';

const fs = require('fs');
const path = require('path');

// Ensure logs directory exists in the workspace
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Clean up logs older than 30 days
const cleanOldLogs = () => {
  try {
    const logFilePath = path.join(logsDir, 'apiHits.log');
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    if (fs.existsSync(logFilePath)) {
      const data = fs.readFileSync(logFilePath, 'utf8');
      const lines = data.split('\n');
      const filteredLines = lines.filter(line => {
        if (!line.trim()) return false;
        const match = line.match(/^\[([^\]]+)\]/);
        if (match) {
          const logDate = new Date(match[1]);
          if (!isNaN(logDate.getTime())) {
            return logDate >= oneMonthAgo;
          }
        }
        return true;
      });
      fs.writeFileSync(logFilePath, filteredLines.join('\n') + '\n', 'utf8');
    }

    // Also clean other old files in logs directory
    const files = fs.readdirSync(logsDir);
    const now = Date.now();
    const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (file === 'apiHits.log') continue;
      const filePath = path.join(logsDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > oneMonthMs) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error('Error during log cleanup:', err.message);
  }
};

cleanOldLogs();

// API Request Logger Middleware
app.use((req, res, next) => {
  const logLine = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}\n`;
  console.log(logLine.trim());
  fs.appendFile(path.join(logsDir, 'apiHits.log'), logLine, (err) => {
    if (err) {
      console.error('Failed to write to apiHits.log:', err.message);
    }
  });
  next();
});

// Body Parser Middleware with fallback for invalid/empty JSON payloads
app.use((req, res, next) => {
  express.json()(req, res, (err) => {
    if (err) {
      req.body = {};
    }
    next();
  });
});

// CORS & Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Direct /health route (http://147.93.105.85:5000/health)
app.get('/health', SystemController.getHealth);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'FestEase Backend API Server is running',
    status: 'online'
  });
});

// Mount Central API Router (/api)
app.use('/api/v1', routes);

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed.',
      errors: {
        body: ['Invalid JSON payload.']
      }
    });
  }
  console.error('Unhandled Error:', err);
  return res.status(500).json({
    success: false,
    message: 'An internal server error occurred.'
  });
});

// Start Express Server
async function startServer() {
  const isConnected = await testConnection();
  if (!isConnected) {
    console.warn('⚠️ Warning: Unable to connect to DB on startup. Server will still start.');
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚀 Server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
