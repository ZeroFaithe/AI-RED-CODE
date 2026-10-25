import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function apiServerPlugin(): Plugin {
  return {
    name: 'api-server-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const urlObj = new URL(req.url, 'http://localhost');
        const pathname = urlObj.pathname;
        let route = pathname.replace(/^\/api\//, '').replace(/\.ts$/, '');
        if (route.endsWith('/')) route = route.slice(0, -1);

        try {
          const mod = await server.ssrLoadModule(`/api/${route}.ts`);
          const handler = mod.default;
          if (!handler) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'API route not found' }));
            return;
          }

          let body: any = undefined;
          if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            const raw = Buffer.concat(chunks).toString('utf-8');
            if (raw) {
              try {
                body = JSON.parse(raw);
              } catch {
                body = raw;
              }
            }
          }

          const query = Object.fromEntries(urlObj.searchParams.entries());
          const customRes: any = res;
          customRes.status = (code: number) => {
            res.statusCode = code;
            return customRes;
          };
          customRes.json = (data: any) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
            return customRes;
          };

          const customReq: any = req;
          customReq.body = body;
          customReq.query = query;

          await handler(customReq, customRes);
        } catch (err: any) {
          console.error(`API Error on ${pathname}:`, err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: err?.message || 'Internal server error' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [react(), apiServerPlugin()],
    base: './',
    test: {
      include: ['tests/**/*.test.ts'],
    },
  } as never;
});

