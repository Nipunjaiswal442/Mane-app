import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(code: number, message: string): never {
  throw new HttpError(code, message);
}
export const uuid = z.string().uuid();
export const token = () => randomBytes(32).toString('hex');
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function id(request: FastifyRequest, key = 'id') {
  return uuid.parse((request.params as Record<string, string>)[key]);
}
export function publicUser(user: any) {
  const { passwordHash, oidcSubject, tokenHash, ...result } = user;
  return result;
}
export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'space';
export const bodySchema = z.object({ body: z.string().trim().min(1).max(20000) });
export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
