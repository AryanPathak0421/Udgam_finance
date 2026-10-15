import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import adminMasterRoutes from './routes/adminMasterRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import memberRoutes from './routes/memberRoutes.js';

const app = express();

// Behind a proxy/load balancer (Render, Railway, Nginx…) so req.ip and secure cookies work.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// CLIENT_ORIGIN accepts one or more comma-separated origins (no trailing slash).
const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      // No Origin header = same-origin or non-browser client (curl, health checks).
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);
// 2mb: company stamp and signature are sent as small base64 images (each capped at ~300 KB).
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/admin-master', adminMasterRoutes);
app.use('/api', groupRoutes);
app.use('/api', memberRoutes);

app.use((_req, res) => res.status(404).json({ message: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
  if (err.name === 'CastError') return res.status(404).json({ message: 'Not found' });
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

export default app;


