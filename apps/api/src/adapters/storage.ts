import { mkdir, open, lstat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export function localEndpoint(raw: string, extraHosts: string[] = []) {
  const url = new URL(raw);
  const hosts = ['localhost', '127.0.0.1', '[::1]', ...extraHosts];
  if (
    !hosts.includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Endpoint must be an explicitly configured appliance-local service');
  return url;
}
export class LocalStorage implements Storage {
  constructor(public root = resolve(process.env.DATA_DIR || process.env.STORAGE_PATH || '../../data')) {}
  path(key: string) {
    const result = resolve(this.root, key);
    if (!key || key.includes('\\') || result === this.root || !result.startsWith(this.root + sep))
      throw new Error('Invalid storage key');
    return result;
  }
  async safePath(key: string) {
    const target = this.path(key);
    const parts = ['', ...target.slice(this.root.length + 1).split(sep)];
    let current = this.root;
    for (const part of parts) {
      current = resolve(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Storage paths must not contain symbolic links');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return target;
  }
  async put(key: string, data: Buffer) {
    const path = await this.safePath(key);
    await mkdir(dirname(path), { recursive: true });
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(data);
    } finally {
      await file.close();
    }
  }
  async get(key: string) {
    const file = await open(await this.safePath(key), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return await file.readFile();
    } finally {
      await file.close();
    }
  }
  async delete(key: string) {
    try {
      await unlink(await this.safePath(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
export class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;
  constructor() {
    const endpoint = localEndpoint(
      process.env.S3_ENDPOINT || 'http://minio:9000',
      (process.env.INTERNAL_HOSTS || '').split(','),
    );
    this.bucket = process.env.S3_BUCKET || 'mane';
    this.client = new S3Client({
      endpoint: endpoint.toString(),
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
      },
    });
  }
  private key(key: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.,-]*$/.test(key) || key.split('/').includes('..'))
      throw new Error('Invalid storage key');
    return key;
  }
  async put(key: string, data: Buffer, mime: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(key), Body: data, ContentType: mime }),
    );
  }
  async get(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
    return Buffer.from(await result.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
  }
}
export const storage: Storage = process.env.STORAGE_BACKEND === 's3' ? new S3Storage() : new LocalStorage();
