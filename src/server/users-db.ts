// server/users-db.ts — User accounts, sessions, agent ownership, cost logs
// Separate SQLite database (admin.db) so user data doesn't mix with game state.

import BetterSqlite3 from 'better-sqlite3';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// --- Types ---

export interface User {
  id: string;
  username: string;
  password_hash: string;
  api_key_encrypted: string | null;
  created_at: string;
  last_login: string | null;
  max_agents: number;
  is_admin: boolean;
}

export interface UserPublic {
  id: string;
  username: string;
  max_agents: number;
  is_admin: boolean;
  has_api_key: boolean;
  created_at: string;
}

export interface Session {
  token: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface UserAgent {
  id: string;
  user_id: string;
  agent_name: string;
  agent_role: string;
  status: string;
  process_pid: number | null;
  config: string | null;
  total_cost: number;
  total_llm_calls: number;
  created_at: string;
  last_active: string | null;
}

export interface CostLogEntry {
  id?: number;
  agent_id: string;
  user_id: string;
  tick: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  estimated_cost: number;
  model: string;
  created_at?: string;
}

// --- Database ---

export class UsersDatabase {
  private db: BetterSqlite3.Database;
  private stmts!: {
    insertUser: BetterSqlite3.Statement;
    getUserById: BetterSqlite3.Statement;
    getUserByUsername: BetterSqlite3.Statement;
    updateLastLogin: BetterSqlite3.Statement;
    updateApiKey: BetterSqlite3.Statement;
    getUserCount: BetterSqlite3.Statement;
    insertSession: BetterSqlite3.Statement;
    getSession: BetterSqlite3.Statement;
    deleteSession: BetterSqlite3.Statement;
    deleteExpiredSessions: BetterSqlite3.Statement;
    insertAgent: BetterSqlite3.Statement;
    getAgentById: BetterSqlite3.Statement;
    getAgentsByUser: BetterSqlite3.Statement;
    getAllAgents: BetterSqlite3.Statement;
    updateAgentStatus: BetterSqlite3.Statement;
    updateAgentCost: BetterSqlite3.Statement;
    deleteAgent: BetterSqlite3.Statement;
    countAgentsByUser: BetterSqlite3.Statement;
    insertCostLog: BetterSqlite3.Statement;
    getCostLogsByAgent: BetterSqlite3.Statement;
    getCostSummaryByUser: BetterSqlite3.Statement;
  };

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.prepareStatements();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        api_key_encrypted TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        last_login TEXT,
        max_agents INTEGER DEFAULT 3,
        is_admin INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS user_agents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        status TEXT DEFAULT 'stopped',
        process_pid INTEGER,
        config TEXT,
        total_cost REAL DEFAULT 0,
        total_llm_calls INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        last_active TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS cost_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        tick INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cache_read_tokens INTEGER,
        estimated_cost REAL,
        model TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (agent_id) REFERENCES user_agents(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
  }

  private prepareStatements(): void {
    this.stmts = {
      insertUser: this.db.prepare(`
        INSERT INTO users (id, username, password_hash, is_admin)
        VALUES (@id, @username, @password_hash, @is_admin)
      `),

      getUserById: this.db.prepare('SELECT * FROM users WHERE id = ?'),

      getUserByUsername: this.db.prepare('SELECT * FROM users WHERE username = ?'),

      updateLastLogin: this.db.prepare(
        "UPDATE users SET last_login = datetime('now') WHERE id = ?"
      ),

      updateApiKey: this.db.prepare(
        'UPDATE users SET api_key_encrypted = ? WHERE id = ?'
      ),

      getUserCount: this.db.prepare('SELECT COUNT(*) as count FROM users'),

      insertSession: this.db.prepare(`
        INSERT INTO sessions (token, user_id, expires_at)
        VALUES (@token, @user_id, @expires_at)
      `),

      getSession: this.db.prepare('SELECT * FROM sessions WHERE token = ?'),

      deleteSession: this.db.prepare('DELETE FROM sessions WHERE token = ?'),

      deleteExpiredSessions: this.db.prepare(
        "DELETE FROM sessions WHERE expires_at < datetime('now')"
      ),

      insertAgent: this.db.prepare(`
        INSERT INTO user_agents (id, user_id, agent_name, agent_role, config)
        VALUES (@id, @user_id, @agent_name, @agent_role, @config)
      `),

      getAgentById: this.db.prepare('SELECT * FROM user_agents WHERE id = ?'),

      getAgentsByUser: this.db.prepare('SELECT * FROM user_agents WHERE user_id = ?'),

      getAllAgents: this.db.prepare('SELECT * FROM user_agents'),

      updateAgentStatus: this.db.prepare(`
        UPDATE user_agents SET status = @status, process_pid = @process_pid,
        last_active = datetime('now') WHERE id = @id
      `),

      updateAgentCost: this.db.prepare(`
        UPDATE user_agents SET total_cost = total_cost + @cost,
        total_llm_calls = total_llm_calls + 1,
        last_active = datetime('now') WHERE id = @id
      `),

      deleteAgent: this.db.prepare('DELETE FROM user_agents WHERE id = ?'),

      countAgentsByUser: this.db.prepare(
        'SELECT COUNT(*) as count FROM user_agents WHERE user_id = ?'
      ),

      insertCostLog: this.db.prepare(`
        INSERT INTO cost_logs (agent_id, user_id, tick, input_tokens, output_tokens,
        cache_read_tokens, estimated_cost, model)
        VALUES (@agent_id, @user_id, @tick, @input_tokens, @output_tokens,
        @cache_read_tokens, @estimated_cost, @model)
      `),

      getCostLogsByAgent: this.db.prepare(
        'SELECT * FROM cost_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100'
      ),

      getCostSummaryByUser: this.db.prepare(`
        SELECT
          SUM(estimated_cost) as total_cost,
          SUM(input_tokens) as total_input_tokens,
          SUM(output_tokens) as total_output_tokens,
          COUNT(*) as total_calls
        FROM cost_logs WHERE user_id = ?
      `),
    };
  }

  // --- User operations ---

  createUser(id: string, username: string, passwordHash: string, isAdmin: boolean): void {
    this.stmts.insertUser.run({
      id,
      username,
      password_hash: passwordHash,
      is_admin: isAdmin ? 1 : 0,
    });
  }

  getUser(id: string): User | null {
    const row = this.stmts.getUserById.get(id) as UserRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  getUserByUsername(username: string): User | null {
    const row = this.stmts.getUserByUsername.get(username) as UserRow | undefined;
    return row ? this.rowToUser(row) : null;
  }

  updateLastLogin(userId: string): void {
    this.stmts.updateLastLogin.run(userId);
  }

  getUserCount(): number {
    const row = this.stmts.getUserCount.get() as { count: number };
    return row.count;
  }

  updateApiKey(userId: string, encryptedKey: string | null): void {
    this.stmts.updateApiKey.run(encryptedKey, userId);
  }

  toPublicUser(user: User): UserPublic {
    return {
      id: user.id,
      username: user.username,
      max_agents: user.max_agents,
      is_admin: user.is_admin,
      has_api_key: user.api_key_encrypted !== null,
      created_at: user.created_at,
    };
  }

  // --- Session operations ---

  createSession(token: string, userId: string, expiresAt: string): void {
    this.stmts.insertSession.run({ token, user_id: userId, expires_at: expiresAt });
  }

  getSession(token: string): Session | null {
    const row = this.stmts.getSession.get(token) as Session | undefined;
    return row ?? null;
  }

  deleteSession(token: string): void {
    this.stmts.deleteSession.run(token);
  }

  cleanExpiredSessions(): void {
    this.stmts.deleteExpiredSessions.run();
  }

  // --- Agent operations ---

  createAgent(id: string, userId: string, name: string, role: string, config?: string): void {
    this.stmts.insertAgent.run({
      id,
      user_id: userId,
      agent_name: name,
      agent_role: role,
      config: config ?? null,
    });
  }

  getAgent(id: string): UserAgent | null {
    const row = this.stmts.getAgentById.get(id) as UserAgent | undefined;
    return row ?? null;
  }

  getAgentsByUser(userId: string): UserAgent[] {
    return this.stmts.getAgentsByUser.all(userId) as UserAgent[];
  }

  getAllAgents(): UserAgent[] {
    return this.stmts.getAllAgents.all() as UserAgent[];
  }

  updateAgentStatus(agentId: string, status: string, pid: number | null = null): void {
    this.stmts.updateAgentStatus.run({ id: agentId, status, process_pid: pid });
  }

  updateAgentCost(agentId: string, cost: number): void {
    this.stmts.updateAgentCost.run({ id: agentId, cost });
  }

  deleteAgent(agentId: string): void {
    this.stmts.deleteAgent.run(agentId);
  }

  countAgentsByUser(userId: string): number {
    const row = this.stmts.countAgentsByUser.get(userId) as { count: number };
    return row.count;
  }

  // --- Cost logging ---

  logCost(entry: CostLogEntry): void {
    this.stmts.insertCostLog.run({
      agent_id: entry.agent_id,
      user_id: entry.user_id,
      tick: entry.tick,
      input_tokens: entry.input_tokens,
      output_tokens: entry.output_tokens,
      cache_read_tokens: entry.cache_read_tokens,
      estimated_cost: entry.estimated_cost,
      model: entry.model,
    });
  }

  getCostLogsByAgent(agentId: string): CostLogEntry[] {
    return this.stmts.getCostLogsByAgent.all(agentId) as CostLogEntry[];
  }

  getCostSummaryByUser(userId: string): {
    total_cost: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_calls: number;
  } {
    const row = this.stmts.getCostSummaryByUser.get(userId) as {
      total_cost: number | null;
      total_input_tokens: number | null;
      total_output_tokens: number | null;
      total_calls: number;
    };
    return {
      total_cost: row.total_cost ?? 0,
      total_input_tokens: row.total_input_tokens ?? 0,
      total_output_tokens: row.total_output_tokens ?? 0,
      total_calls: row.total_calls,
    };
  }

  // --- Encryption helpers (API key at rest) ---

  static encryptApiKey(plainKey: string, encryptionKey: string): string {
    const key = Buffer.from(encryptionKey, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Store as iv:tag:ciphertext (all hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  static decryptApiKey(encryptedStr: string, encryptionKey: string): string {
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted key format');
    const iv = Buffer.from(parts[0]!, 'hex');
    const tag = Buffer.from(parts[1]!, 'hex');
    const encrypted = Buffer.from(parts[2]!, 'hex');
    const key = Buffer.from(encryptionKey, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }

  // --- Internal ---

  private rowToUser(row: UserRow): User {
    return {
      id: row.id,
      username: row.username,
      password_hash: row.password_hash,
      api_key_encrypted: row.api_key_encrypted,
      created_at: row.created_at,
      last_login: row.last_login,
      max_agents: row.max_agents,
      is_admin: row.is_admin === 1,
    };
  }
}

// --- Row types ---

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  api_key_encrypted: string | null;
  created_at: string;
  last_login: string | null;
  max_agents: number;
  is_admin: number; // SQLite stores booleans as 0/1
}
