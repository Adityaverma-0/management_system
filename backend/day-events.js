// Push only invalidations; all business data is re-fetched through authorized APIs.
// Periodic client refresh also covers reconnects and deployments with multiple API workers.
import { EventEmitter } from 'node:events';
export function installDayEvents(app) {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  app.use('/api/v2/unload-requests', (req, res, next) => {
    if (req.method === 'POST') res.once('finish', () => {
      if (res.statusCode < 300) events.emit('changed');
    });
    next();
  });
  app.get('/api/v2/day-events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = () => res.write('data: changed\n\n');
    events.on('changed', send);
    // Revalidate the session on reconnect; do not keep expired sessions streaming.
    const expiry = setTimeout(() => res.end(), 60000);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    send();
    res.once('close', () => {
      clearTimeout(expiry); clearInterval(heartbeat); events.off('changed', send);
    });
  });
}
