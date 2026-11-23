import { createServer } from 'node:http';
import { createSyncHandler } from './service';
import { MemoryRepository } from './memory';
const repository = new MemoryRepository();
const handler = createSyncHandler(repository, ['https://xr-su.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
const server = createServer(async (req, res) => {
  let body = ''; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 5 * 1024 * 1024) { res.writeHead(413); res.end(); return; }
    body += part.toString();
  }
  const result = await handler({ httpMethod: req.method, headers: req.headers as Record<string, string>, body });
  res.writeHead(result.statusCode, result.headers); res.end(result.statusCode === 204 ? undefined : result.body);
});
server.listen(8787, '127.0.0.1', () => console.log('Local sync contract server: http://127.0.0.1:8787/diary-sync (temporary in-memory storage)'));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
