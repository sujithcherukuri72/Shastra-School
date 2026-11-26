import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { env, uploadRoot } from '../config/env.ts';
import { type Db, pool, q1 } from '../db/pool.ts';
import { badRequest } from './http.ts';
import { sha256Hex } from '../security/crypto.ts';

/** Accepted types are decided by the file's real bytes (magic numbers), never by name or client MIME. */
const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Multer keeps uploads in memory (bounded by MAX_UPLOAD_MB) so nothing unchecked touches disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 2, fields: 30, fieldSize: 64 * 1024, parts: 40 },
});

export interface StoredFile {
  id: string;
  original_name: string;
  mime: string;
  size_bytes: number;
}

function cleanName(name: string) {
  const base = path.basename(name).normalize('NFKC').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
  return base || 'file';
}

export async function saveUpload(file: Express.Multer.File | undefined, userId: string, db: Db = pool): Promise<StoredFile> {
  if (!file || !file.buffer?.length) throw badRequest('Please attach a file');
  const type = await fileTypeFromBuffer(file.buffer);
  if (!type || !ALLOWED[type.mime]) throw badRequest('Only PDF, Word (.docx), PNG, JPG or WEBP files are allowed');
  const now = new Date();
  const key = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), randomUUID());
  const abs = path.join(uploadRoot, key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, file.buffer, { flag: 'wx', mode: 0o640 });
  const ext = ALLOWED[type.mime];
  const original = cleanName(file.originalname).replace(/\.[^.]+$/, '') + '.' + ext;
  const row = await q1<StoredFile>(
    `INSERT INTO files (storage_key, original_name, mime, size_bytes, sha256, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, original_name, mime, size_bytes`,
    [key, original, type.mime, file.buffer.length, sha256Hex(file.buffer), userId],
    db,
  );
  return row!;
}

/** Store a server-generated buffer (e.g. a PDF report) the same way. */
export async function saveBuffer(buf: Buffer, name: string, mime: string, userId: string | null, db: Db = pool): Promise<StoredFile> {
  const now = new Date();
  const key = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), randomUUID());
  const abs = path.join(uploadRoot, key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf, { flag: 'wx', mode: 0o640 });
  const row = await q1<StoredFile>(
    `INSERT INTO files (storage_key, original_name, mime, size_bytes, sha256, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, original_name, mime, size_bytes`,
    [key, cleanName(name), mime, buf.length, sha256Hex(buf), userId],
    db,
  );
  return row!;
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  const abs = path.resolve(uploadRoot, storageKey);
  // Defence against path traversal even though keys are server-generated.
  if (!abs.startsWith(uploadRoot + path.sep)) throw badRequest('Invalid file');
  return readFile(abs);
}
