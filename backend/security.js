import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256 || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !/^[a-f0-9]{128}$/i.test(hash || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(password, salt, 64));
}
export function safeUser(row) {
  const { password_hash, ...user } = row;
  return { ...user, mobile: row.phone, status: row.active === false ? 'INACTIVE' : row.status || 'ACTIVE', has_password: Boolean(password_hash) };
}
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
export function installSecurity(app, pool) {
  const failures = new Map();
  const limiter = (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    for (const [k, v] of failures) if (v.until < now) failures.delete(k);
    const entry = failures.get(key) || { count: 0, until: now + 600000 };
    if (++entry.count > 30) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in ten minutes.' });
    failures.set(key, entry); next();
  };
  const login = requestedRole => async (req, res) => {
    try {
      const body = req.body || {};
      let user;
      const identifier = String(body.identifier ?? body.username ?? body.mobile ?? '').trim();
      let role = requestedRole || 'admin';
      if (requestedRole !== 'salesman') {
        if (requestedRole === 'admin' && !process.env.ADMIN_PASSWORD_HASH) return res.status(503).json({ error: 'Admin credentials are not configured. Run the secure admin setup command.' });
        if (identifier === (process.env.ADMIN_USERNAME || 'admin') && verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH)) user = { id: 'admin', username: identifier, role: 'admin' };
      }
      if (!user && requestedRole !== 'admin') {
        role = 'salesman';
        const { rows } = await pool.query('SELECT * FROM salesmen WHERE phone=$1', [identifier]);
        if (rows[0]?.active && rows[0].status === 'ACTIVE' && verifyPassword(body.password, rows[0].password_hash)) user = { ...safeUser(rows[0]), role };
      }
      if (!user) return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query('INSERT INTO auth_sessions(token_hash,user_id,role,expires_at) VALUES($1,$2,$3,now()+interval \'12 hours\')', [digest(token), user.id, role]);
      res.json({ token, user });
    } catch { res.status(503).json({ error: 'Sign-in service unavailable. Please retry.' }); }
  };
  app.post('/api/v2/login', limiter, login());
  app.post('/api/v2/admin/login', limiter, login('admin'));
  app.post('/api/v2/salesman/login', limiter, login('salesman'));

  const generalRequests = new Map();
  const generalLimiter = (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    for (const [k, v] of generalRequests) if (v.until < now) generalRequests.delete(k);
    const entry = generalRequests.get(key) || { count: 0, until: now + 60000 };
    if (++entry.count > 300) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    generalRequests.set(key, entry);
    next();
  };
  app.use('/api/v2', generalLimiter);

  app.use('/api/v2', async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    try {
      const { rows } = await pool.query('SELECT * FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()', [digest(token)]);
      const session = rows[0];
      if (!session) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      req.user = { id: session.user_id, role: session.role, ...(session.role === 'admin' ? {username:process.env.ADMIN_USERNAME || 'admin'} : {}) };
      if (session.role === 'salesman') {
        const { rows: people } = await pool.query('SELECT * FROM salesmen WHERE id=$1 AND active=TRUE AND status=\'ACTIVE\'', [session.user_id]);
        if (!people[0]) return res.status(401).json({ error: 'Account is inactive.' });
        req.user = { ...safeUser(people[0]), role: 'salesman' };
      }
      const routePath = req.path.toLowerCase();
      if ((routePath.startsWith('/admin') || (routePath.startsWith('/unload-requests') && (req.method === 'GET' && routePath === '/unload-requests' || /\/(approve|send-back)$/.test(routePath)))) && req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
      if (routePath.startsWith('/salesman') && req.user.role !== 'salesman') return res.status(403).json({ error: 'Salesman access required.' });
      next();
    } catch { res.status(503).json({ error: 'Session could not be validated.' }); }
  });
  app.get('/api/v2/session', (req, res) => res.json({ user: req.user }));
  app.post('/api/v2/logout', async (req, res) => {
    try { await pool.query('DELETE FROM auth_sessions WHERE token_hash=$1', [digest(req.headers.authorization.slice(7))]); res.json({ success: true }); }
    catch { res.status(503).json({ error: 'Logout could not be completed. Retry.' }); }
  });
}
