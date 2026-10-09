import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type UserRole = 'Farmer' | 'Water Resource Officer' | 'Researcher' | 'Administrator';

export interface User {
  id: string;
  fullName: string;
  email: string;
  passwordHash: string; // "scrypt$salt$hash"
  role: UserRole;
  createdAt: string;
  organization?: string;
  district?: string;
  commandArea?: string;
  phone?: string;
  isApprovedAdmin?: boolean;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  createdAt: number;
  expiresAt: number;
}

export interface PasswordResetToken {
  token: string;
  userId: string;
  expiresAt: number;
}

export interface UserPublicProfile {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  createdAt: string;
  organization?: string;
  district?: string;
  commandArea?: string;
  phone?: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const RESETS_FILE = path.join(DATA_DIR, 'password_resets.json');

// Ensure storage directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Cryptographic Password Hashing using Node's standard crypto.scrypt
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      return false;
    }
    const salt = parts[1];
    const originalHash = parts[2];
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(derivedKey.toString('hex'), 'hex');
    const origBuffer = Buffer.from(originalHash, 'hex');
    if (keyBuffer.length !== origBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(keyBuffer, origBuffer);
  } catch {
    return false;
  }
}

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return fallback;
  }
}

function writeJSON<T>(filePath: string, data: T): void {
  try {
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Seed default demo accounts if not already present
export function initAuthDatabase(): void {
  let users = readJSON<User[]>(USERS_FILE, []);
  if (users.length === 0) {
    users = [
      {
        id: 'usr_admin_1',
        fullName: 'Dr. K. S. Rao (Chief Engineer)',
        email: 'admin@jalamitra.gov.in',
        passwordHash: hashPassword('JalaMitra@2026'),
        role: 'Administrator',
        createdAt: '2026-01-15T08:00:00.000Z',
        organization: 'AP Water Resources Dept (APWRD)',
        district: 'Vijayawada, Krishna Basin',
        commandArea: 'Krishna-Godavari Central Command',
        phone: '+91 866 247 1100',
        isApprovedAdmin: true,
      },
      {
        id: 'usr_officer_1',
        fullName: 'V. Lalitha Sree (Executive Water Officer)',
        email: 'officer@jalamitra.gov.in',
        passwordHash: hashPassword('JalaMitra@2026'),
        role: 'Water Resource Officer',
        createdAt: '2026-02-01T09:30:00.000Z',
        organization: 'Nagarjuna Sagar Right Canal Division',
        district: 'Guntur / Palnadu',
        commandArea: 'Nagarjuna Sagar Command',
        phone: '+91 8642 223401',
      },
      {
        id: 'usr_farmer_1',
        fullName: 'Ramana Reddy (Farmer Representative)',
        email: 'farmer@jalamitra.gov.in',
        passwordHash: hashPassword('JalaMitra@2026'),
        role: 'Farmer',
        createdAt: '2026-03-10T10:00:00.000Z',
        organization: 'Tenali Ayacut Rythu Mitra Sangham',
        district: 'Guntur',
        commandArea: 'Krishna Delta Western Canal',
        phone: '+91 98480 12345',
      },
      {
        id: 'usr_researcher_1',
        fullName: 'Prof. Ananya Sen (Quantum Systems Lab)',
        email: 'researcher@jalamitra.gov.in',
        passwordHash: hashPassword('JalaMitra@2026'),
        role: 'Researcher',
        createdAt: '2026-04-05T11:00:00.000Z',
        organization: 'Qiskit Fall Fest Optimization Group',
        district: 'Hyderabad / Amaravati',
        commandArea: 'Basin-wide Computational Modeling',
        phone: '+91 40 2313 4000',
      },
    ];
    writeJSON(USERS_FILE, users);
    console.info(`Initialized JalaMitra Auth Database with ${users.length} verified baseline role accounts.`);
  }
}

// User CRUD operations
export function getUserByEmail(email: string): User | undefined {
  const users = readJSON<User[]>(USERS_FILE, []);
  return users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
}

export function getUserById(id: string): User | undefined {
  const users = readJSON<User[]>(USERS_FILE, []);
  return users.find((u) => u.id === id);
}

export function getAllUsers(): User[] {
  return readJSON<User[]>(USERS_FILE, []);
}

export function createUser(userData: {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  organization?: string;
  district?: string;
  commandArea?: string;
  phone?: string;
  isApprovedAdmin?: boolean;
}): { user?: User; error?: string } {
  const users = readJSON<User[]>(USERS_FILE, []);
  const cleanEmail = userData.email.trim().toLowerCase();

  if (users.some((u) => u.email.toLowerCase() === cleanEmail)) {
    return { error: 'An account with this email address already exists. Please log in or use a different email.' };
  }

  const newUser: User = {
    id: `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    fullName: userData.fullName.trim(),
    email: cleanEmail,
    passwordHash: hashPassword(userData.password),
    role: userData.role,
    createdAt: new Date().toISOString(),
    organization: userData.organization?.trim() || (userData.role === 'Farmer' ? 'Local Rythu Committee' : 'Irrigation Wing'),
    district: userData.district?.trim() || 'Krishna Basin Command',
    commandArea: userData.commandArea?.trim() || 'Prakasam / Nagarjuna Sagar Barrage',
    phone: userData.phone?.trim(),
    isApprovedAdmin: userData.role === 'Administrator' ? !!userData.isApprovedAdmin : undefined,
  };

  users.push(newUser);
  writeJSON(USERS_FILE, users);
  return { user: newUser };
}

export function updateUser(id: string, updates: Partial<Omit<User, 'id' | 'passwordHash'>>): User | null {
  const users = readJSON<User[]>(USERS_FILE, []);
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return null;

  users[idx] = { ...users[idx], ...updates };
  writeJSON(USERS_FILE, users);
  return users[idx];
}

export function deleteUser(id: string): boolean {
  const users = readJSON<User[]>(USERS_FILE, []);
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length === users.length) return false;
  writeJSON(USERS_FILE, filtered);
  return true;
}

export function updateUserPassword(id: string, newPassword: string): boolean {
  const users = readJSON<User[]>(USERS_FILE, []);
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return false;

  users[idx].passwordHash = hashPassword(newPassword);
  writeJSON(USERS_FILE, users);
  return true;
}

// Session Token Management
export function createSession(userId: string, role: UserRole, rememberMe: boolean = false): string {
  const sessions = readJSON<UserSession[]>(SESSIONS_FILE, []);
  const sessionId = crypto.randomBytes(32).toString('hex');
  const durationMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 30 days or 24 hours
  const now = Date.now();

  // Purge expired sessions
  const validSessions = sessions.filter((s) => s.expiresAt > now);

  validSessions.push({
    sessionId,
    userId,
    role,
    createdAt: now,
    expiresAt: now + durationMs,
  });

  writeJSON(SESSIONS_FILE, validSessions);
  return sessionId;
}

export function validateSession(sessionId: string): { user: User; session: UserSession } | null {
  if (!sessionId) return null;
  const sessions = readJSON<UserSession[]>(SESSIONS_FILE, []);
  const now = Date.now();
  const session = sessions.find((s) => s.sessionId === sessionId && s.expiresAt > now);
  if (!session) return null;

  const user = getUserById(session.userId);
  if (!user) return null;

  return { user, session };
}

export function destroySession(sessionId: string): void {
  const sessions = readJSON<UserSession[]>(SESSIONS_FILE, []);
  const remaining = sessions.filter((s) => s.sessionId !== sessionId);
  writeJSON(SESSIONS_FILE, remaining);
}

// Password Reset Tokens
export function createPasswordResetToken(userId: string): string {
  const resets = readJSON<PasswordResetToken[]>(RESETS_FILE, []);
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + 60 * 60 * 1000; // 1 hour validity

  const validResets = resets.filter((r) => r.expiresAt > now && r.userId !== userId);
  validResets.push({ token, userId, expiresAt });
  writeJSON(RESETS_FILE, validResets);
  return token;
}

export function verifyAndConsumeResetToken(token: string): string | null {
  const resets = readJSON<PasswordResetToken[]>(RESETS_FILE, []);
  const now = Date.now();
  const entry = resets.find((r) => r.token === token && r.expiresAt > now);
  if (!entry) return null;

  // Consume token so it cannot be reused
  const remaining = resets.filter((r) => r.token !== token);
  writeJSON(RESETS_FILE, remaining);
  return entry.userId;
}

export function toPublicProfile(user: User): UserPublicProfile {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    organization: user.organization,
    district: user.district,
    commandArea: user.commandArea,
    phone: user.phone,
  };
}
