import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);
createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  response.writeHead(501, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      error: 'Webhook delivery is deferred to a future milestone',
    }),
  );
}).listen(port, () =>
  console.log(`CIRelay webhook skeleton listening on ${port}`),
);
