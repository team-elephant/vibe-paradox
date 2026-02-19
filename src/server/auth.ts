// server/auth.ts — Authentication endpoints and middleware
// Simple session-based auth. No OAuth, no JWT.

import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import type { UsersDatabase, User } from './users-db.js';

const BCRYPT_ROUNDS = 10;
const SESSION_EXPIRY_DAYS = 7;
const MIN_PASSWORD_LENGTH = 8;
const MAX_USERNAME_LENGTH = 32;

// --- Request types ---

export interface AuthenticatedRequest extends IncomingMessage {
  user?: User;
}

type RouteHandler = (
  req: AuthenticatedRequest,
  res: ServerResponse,
  body: Record<string, unknown>,
) => Promise<void> | void;

// --- Auth Router ---

export class AuthRouter {
  private db: UsersDatabase;

  constructor(db: UsersDatabase) {
    this.db = db;
    this.bootstrapAdmin();
  }

  /** Try to handle /api/auth/* requests. Returns true if handled. */
  async handleRequest(req: AuthenticatedRequest, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method || 'GET';

    // CORS headers for API
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return true;
    }

    const routes: Record<string, Record<string, RouteHandler>> = {
      '/api/auth/signup': { POST: this.signup.bind(this) },
      '/api/auth/login': { POST: this.login.bind(this) },
      '/api/auth/logout': { POST: this.logout.bind(this) },
      '/api/auth/me': { GET: this.me.bind(this) },
    };

    const routeHandlers = routes[path];
    if (!routeHandlers) return false;

    const handler = routeHandlers[method];
    if (!handler) {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return true;
    }

    try {
      const body = method === 'GET' ? {} : await parseJsonBody(req);
      await handler(req, res, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }

    return true;
  }

  // --- Auth middleware ---

  async authenticate(req: AuthenticatedRequest): Promise<User | null> {
    const token = extractToken(req);
    if (!token) return null;

    const session = this.db.getSession(token);
    if (!session) return null;

    if (new Date(session.expires_at) < new Date()) {
      this.db.deleteSession(token);
      return null;
    }

    const user = this.db.getUser(session.user_id);
    return user;
  }

  // --- Route handlers ---

  private async signup(
    _req: AuthenticatedRequest,
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    // Validate
    if (!username || !password) {
      sendJson(res, 400, { error: 'Username and password are required' });
      return;
    }

    if (username.length > MAX_USERNAME_LENGTH) {
      sendJson(res, 400, { error: `Username must be ${MAX_USERNAME_LENGTH} characters or less` });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      sendJson(res, 400, { error: 'Username may only contain letters, numbers, hyphens, and underscores' });
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      sendJson(res, 400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    // Check uniqueness
    const existing = this.db.getUserByUsername(username);
    if (existing) {
      sendJson(res, 409, { error: 'Username already taken' });
      return;
    }

    // First user gets admin
    const isFirstUser = this.db.getUserCount() === 0;

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    this.db.createUser(userId, username, passwordHash, isFirstUser);
    this.db.updateLastLogin(userId);

    // Create session
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    this.db.createSession(token, userId, expiresAt);

    const user = this.db.getUser(userId)!;
    sendJson(res, 201, {
      token,
      user: this.db.toPublicUser(user),
    });
  }

  private async login(
    _req: AuthenticatedRequest,
    res: ServerResponse,
    body: Record<string, unknown>,
  ): Promise<void> {
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username || !password) {
      sendJson(res, 400, { error: 'Username and password are required' });
      return;
    }

    const user = this.db.getUserByUsername(username);
    if (!user) {
      sendJson(res, 401, { error: 'Invalid username or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      sendJson(res, 401, { error: 'Invalid username or password' });
      return;
    }

    this.db.updateLastLogin(user.id);

    // Create session
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    this.db.createSession(token, user.id, expiresAt);

    sendJson(res, 200, {
      token,
      user: this.db.toPublicUser(user),
    });
  }

  private async logout(
    req: AuthenticatedRequest,
    res: ServerResponse,
    _body: Record<string, unknown>,
  ): Promise<void> {
    const token = extractToken(req);
    if (!token) {
      sendJson(res, 401, { error: 'No token provided' });
      return;
    }

    this.db.deleteSession(token);
    sendJson(res, 200, { ok: true });
  }

  private async me(
    req: AuthenticatedRequest,
    res: ServerResponse,
    _body: Record<string, unknown>,
  ): Promise<void> {
    const user = await this.authenticate(req);
    if (!user) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    sendJson(res, 200, { user: this.db.toPublicUser(user) });
  }

  // --- Bootstrap ---

  private bootstrapAdmin(): void {
    if (this.db.getUserCount() > 0) return;

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) return;

    const userId = uuidv4();
    const passwordHash = bcrypt.hashSync(adminPassword, BCRYPT_ROUNDS);
    this.db.createUser(userId, adminUsername, passwordHash, true);
    console.log(`[VP] Bootstrap admin user created: ${adminUsername}`);
  }
}

// --- Helpers ---

function extractToken(req: IncomingMessage): string | null {
  // Try Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Try query param (for WebSocket connections)
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('token');
    if (token) return token;
  } catch {
    // ignore parse errors
  }

  return null;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolve({});
          return;
        }
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new Error('Request body must be a JSON object'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}
