import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authRoutes } from './routes/auth';
import { articleRoutes } from './routes/articles';
import { fileRoutes } from './routes/files';

export type Env = {
  STORAGE: R2Bucket;
  SESSIONS: KVNamespace;
  ARTICLES: KVNamespace;
  ALLOWED_ORIGIN: string;
  ADMIN_ADDRESSES: string;
};

const app = new Hono<{ Bindings: Env }>();

// PAI-0009: security headers
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: {
      camera: [],
      microphone: [],
      geolocation: [],
    },
  }),
);

app.use(
  '*',
  cors({
    origin: (origin, c) => c.env.ALLOWED_ORIGIN,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
);

app.get('/', (c) => c.json({ name: 'basepress-api', version: '0.2.0' }));

app.route('/auth', authRoutes);
app.route('/articles', articleRoutes);
app.route('/file', fileRoutes);

export default app;
