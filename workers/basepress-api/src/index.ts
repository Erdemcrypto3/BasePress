import { Hono } from 'hono';
import { cors } from 'hono/cors';
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

app.use(
  '*',
  cors({
    origin: (origin, c) => c.env.ALLOWED_ORIGIN,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
);

app.get('/', (c) => c.json({ name: 'basepress-api', version: '0.1.0' }));

app.route('/auth', authRoutes);
app.route('/articles', articleRoutes);
app.route('/file', fileRoutes);

export default app;
