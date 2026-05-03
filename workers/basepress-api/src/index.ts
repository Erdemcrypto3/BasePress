import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authRoutes } from './routes/auth';
import { articleRoutes } from './routes/articles';
import { draftRoutes } from './routes/drafts';
import { tagRoutes } from './routes/tags';
import { fileRoutes } from './routes/files';
import { adminRoutes } from './routes/admins';

export type Env = {
  STORAGE: R2Bucket;
  SESSIONS: KVNamespace;
  ARTICLES: KVNamespace;
  DRAFTS: KVNamespace;
  ALLOWED_ORIGIN: string;
  ADMIN_ADDRESSES: string;
  // PAI-0017: address that should recover from every signed MintPermit. Set in
  // wrangler.toml [vars] and rotated when the on-chain platformSigner rotates.
  PLATFORM_SIGNER: string;
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
    // P001-PAI-0035: validate incoming origin before reflecting CORS header
    origin: (origin, c) => origin === c.env.ALLOWED_ORIGIN ? origin : '',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
);

app.get('/', (c) => c.json({ name: 'basepress-api', version: '0.2.0' }));

app.route('/auth', authRoutes);
app.route('/articles', articleRoutes);
app.route('/drafts', draftRoutes);
app.route('/tags', tagRoutes);
app.route('/file', fileRoutes);
app.route('/admins', adminRoutes);

export default app;
