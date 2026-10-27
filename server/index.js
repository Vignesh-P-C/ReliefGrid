require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { verifyToken, tokenFromHeader } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');

// Security headers (Audit #50). Hand-rolled rather than pulling in helmet: this
// API answers JSON only, so the set it needs is short and explicit.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// CORS is an allowlist (Audit #50), not '*'. A request with no Origin header —
// curl, server-to-server, the same-origin frontends — is allowed: only a
// browser can be tricked into sending a foreign Origin.
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'https://relief-grid-five.vercel.app',
  'https://relief-grid-egia.vercel.app',
];
const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Vercel preview deployments get a new hostname every build, so previews of
  // the two known projects are accepted by pattern. Setting CORS_ORIGINS in the
  // environment replaces all of this with an exact list.
  if (configuredOrigins.length === 0) {
    try {
      const host = new URL(origin).hostname;
      return /^relief-grid-[a-z0-9-]*vigneshs-projects-e06a05b8\.vercel\.app$/.test(host)
        || /^relief-grid-(five|egia)\.vercel\.app$/.test(host);
    } catch (err) {
      return false;
    }
  }
  return false;
}

app.use(cors({
  origin(origin, callback) {
    // Answering without the CORS headers lets the browser block the response,
    // rather than failing the request with a 500 the client cannot read.
    callback(null, isAllowedOrigin(origin));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) },
});
app.set('io', io);

// Socket.IO handshake authentication (Audit #49). Every socket presents the
// same JWT the HTTP routes use; an anonymous client is refused at connect, so
// it cannot subscribe to operational events at all. The payloads those events
// carry are identifiers only — requester names and phone numbers are never
// broadcast (see the emit in routes/aidRequests.js).
io.use((socket, next) => {
  const token = (socket.handshake.auth && socket.handshake.auth.token)
    || tokenFromHeader(socket.handshake.headers.authorization);
  const user = verifyToken(token);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  return next();
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id} (user ${socket.data.user.user_id})`);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/shelters', require('./routes/shelters'));
app.use('/api/aid-requests', require('./routes/aidRequests'));
app.use('/api/supplies', require('./routes/supplies'));
app.use('/api/events', require('./routes/events'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`ReliefGrid server running on port ${PORT}`));
