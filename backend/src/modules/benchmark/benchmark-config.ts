import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { UserRole } from '../../types/index.js';

export interface BenchmarkControllerConfig {
  controllerId: string;
  controllerName: string;
  controllerEmail: string;
  controllerRole?: UserRole;
  assignedAt: string;
  assignedBy: string;
}

function resolvedPath(): string {
  const fromRoot = resolve(process.cwd(), 'backend', 'data', 'benchmark-config.json');
  const fromBackend = resolve(process.cwd(), 'data', 'benchmark-config.json');
  // Prefer backend/data if backend/ folder exists in cwd; otherwise data/ inside cwd
  if (existsSync(resolve(process.cwd(), 'data'))) {
    return fromBackend;
  }
  return fromRoot;
}

function ensureFileExists(): string {
  const filePath = resolvedPath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(null, null, 2), 'utf8');
  }
  return filePath;
}

export function getBenchmarkControllerConfig(): BenchmarkControllerConfig | null {
  try {
    const filePath = ensureFileExists();
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    const data = JSON.parse(raw) as BenchmarkControllerConfig | null;
    return data;
  } catch {
    return null;
  }
}

export function setBenchmarkControllerConfig(config: BenchmarkControllerConfig | null): void {
  const filePath = ensureFileExists();
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

export function isBenchmarkController(user?: {
  userId?: string;
  empCode?: string;
  email?: string;
}): boolean {
  if (!user) return false;
  const config = getBenchmarkControllerConfig();
  if (!config || !config.controllerId) return false;
  const targetId = config.controllerId.trim().toLowerCase();
  const targetEmail = (config.controllerEmail || '').trim().toLowerCase();
  return (
    (Boolean(user.empCode) && user.empCode!.trim().toLowerCase() === targetId) ||
    (Boolean(user.userId) && user.userId!.trim().toLowerCase() === targetId) ||
    (Boolean(user.email) && Boolean(targetEmail) && user.email!.trim().toLowerCase() === targetEmail)
  );
}
