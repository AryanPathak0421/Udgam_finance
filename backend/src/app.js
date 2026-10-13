import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import adminMasterRoutes from './routes/adminMasterRoutes.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
// 1mb: the company stamp is sent as a small base64 image (capped at ~300 KB by validation).
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/admin-master', adminMasterRoutes);

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
