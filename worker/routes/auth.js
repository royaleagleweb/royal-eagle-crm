// Port of src/routes/auth.js. bcrypt → PBKDF2 (WebCrypto), jsonwebtoken →
// hand-rolled HS256 JWT. Behavior (status codes, payloads, first-user-admin,
// closed registration) is identical.

import { json, badRequest } from '../helpers.js';
import { signToken, hashPassword, verifyPassword, jwtSecret } from '../security.js';

const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });

export function registerAuthRoutes(add) {
  // The first registered user becomes the admin; afterwards only admins can add users.
  add('POST', '/api/auth/register', async (c) => {
    const { name, email, password } = c.body || {};
    if (!name || !email || !password) throw badRequest('name, email and password are required');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');

    const userCount = (await c.db.prepare('SELECT COUNT(*) AS n FROM users').first()).n;
    if (userCount > 0) {
      // Registration is closed once the workspace has an owner — go through POST /users.
      return json({ error: 'Registration is closed. Ask an admin to create your account.' }, 403);
    }

    const passwordHash = await hashPassword(password);
    const info = await c.db
      .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .bind(name, email, passwordHash)
      .run();
    const user = await c.db.prepare('SELECT * FROM users WHERE id = ?').bind(info.meta.last_row_id).first();
    return json({ token: await signToken(user, jwtSecret(c.env)), user: publicUser(user) }, 201);
  }, { auth: false });

  add('POST', '/api/auth/login', async (c) => {
    const { email, password } = c.body || {};
    if (!email || !password) throw badRequest('email and password are required');

    const user = await c.db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
      return json({ error: 'Invalid email or password' }, 401);
    }
    return json({ token: await signToken(user, jwtSecret(c.env)), user: publicUser(user) });
  }, { auth: false });

  add('GET', '/api/auth/me', (c) => json({ user: c.user }));

  // Admin user management
  add('GET', '/api/auth/users', async (c) => {
    const { results } = await c.db
      .prepare('SELECT id, name, email, role, is_active, created_at FROM users ORDER BY id')
      .all();
    return json(results);
  }, { admin: true });

  add('POST', '/api/auth/users', async (c) => {
    const { name, email, password, role = 'staff' } = c.body || {};
    if (!name || !email || !password) throw badRequest('name, email and password are required');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (!['admin', 'staff'].includes(role)) throw badRequest('role must be admin or staff');
    if (await c.db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) throw badRequest('Email is already in use');

    const passwordHash = await hashPassword(password);
    const info = await c.db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .bind(name, email, passwordHash, role)
      .run();
    const user = await c.db
      .prepare('SELECT id, name, email, role, is_active, created_at FROM users WHERE id = ?')
      .bind(info.meta.last_row_id)
      .first();
    return json(user, 201);
  }, { admin: true });

  add('PATCH', '/api/auth/users/:id', async (c) => {
    const user = await c.db.prepare('SELECT * FROM users WHERE id = ?').bind(c.params.id).first();
    if (!user) return json({ error: 'User not found' }, 404);

    const { name, role, is_active, password } = c.body || {};
    if (role && !['admin', 'staff'].includes(role)) throw badRequest('role must be admin or staff');
    if (password && password.length < 8) throw badRequest('Password must be at least 8 characters');
    const passwordHash = password ? await hashPassword(password) : user.password_hash;

    await c.db
      .prepare("UPDATE users SET name = ?, role = ?, is_active = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(name ?? user.name, role ?? user.role, is_active === undefined ? user.is_active : (is_active ? 1 : 0), passwordHash, user.id)
      .run();
    return json(await c.db.prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ?').bind(user.id).first());
  }, { admin: true });
}
