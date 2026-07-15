// Port of src/routes/files.js. The API is identical (JSON base64 upload,
// authenticated download, 10 MB cap) but file bytes live in R2 (binding
// FILES, key = file id) while D1 keeps only the metadata row.

import { json, noContent, badRequest, notFound, all } from '../helpers.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

function base64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function registerFileRoutes(add) {
  add('GET', '/api/files', async (c) => {
    const { company_id } = c.query;
    const where = company_id ? 'WHERE f.company_id = ?' : '';
    const params = company_id ? [company_id] : [];
    return json(await all(c.db, `
      SELECT f.id, f.name, f.mime, f.size, f.company_id, f.related_type, f.related_id, f.created_at,
             c.name AS company_name, u.name AS uploaded_by_name
      FROM files f
      LEFT JOIN companies c ON c.id = f.company_id
      LEFT JOIN users u ON u.id = f.uploaded_by
      ${where} ORDER BY f.created_at DESC
    `, params));
  });

  // Upload as JSON: { name, mime, data (base64), company_id?, related_type?, related_id? }
  add('POST', '/api/files', async (c) => {
    const b = c.body || {};
    if (!b.name || !String(b.name).trim()) throw badRequest('name is required');
    if (!b.data) throw badRequest('data (base64) is required');
    let bytes;
    try { bytes = base64ToBytes(b.data); } catch { throw badRequest('data is not valid base64'); }
    if (bytes.length === 0) throw badRequest('File is empty');
    if (bytes.length > MAX_FILE_BYTES) throw badRequest('File is larger than the 10 MB limit');

    const info = await c.db.prepare(`
      INSERT INTO files (name, mime, size, r2_key, company_id, related_type, related_id, uploaded_by)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
    `).bind(String(b.name).trim(), b.mime || 'application/octet-stream', bytes.length,
            b.company_id ?? null, b.related_type ?? null, b.related_id ?? null, c.user.id).run();
    const id = info.meta.last_row_id;

    // Bytes go to R2 under the file id; the row records the key.
    await c.env.FILES.put(String(id), bytes);
    await c.db.prepare('UPDATE files SET r2_key = ? WHERE id = ?').bind(String(id), id).run();

    const file = await c.db.prepare('SELECT id, name, mime, size, company_id, related_type, related_id, created_at FROM files WHERE id = ?')
      .bind(id).first();
    return json(file, 201);
  });

  add('GET', '/api/files/:id/download', async (c) => {
    const file = await c.db.prepare('SELECT * FROM files WHERE id = ?').bind(c.params.id).first();
    if (!file) throw notFound('File not found');
    const object = await c.env.FILES.get(file.r2_key ?? String(file.id));
    if (!object) throw notFound('File not found');
    return new Response(object.body, {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
      },
    });
  });

  add('DELETE', '/api/files/:id', async (c) => {
    const file = await c.db.prepare('SELECT id, r2_key FROM files WHERE id = ?').bind(c.params.id).first();
    if (!file) throw notFound('File not found');
    await c.db.prepare('DELETE FROM files WHERE id = ?').bind(file.id).run();
    await c.env.FILES.delete(file.r2_key ?? String(file.id));
    return noContent();
  });
}
