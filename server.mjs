import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const STATIC = join(ROOT, 'static');
const DATA_DIR = join(ROOT, 'data');
const DATA_FILE = join(DATA_DIR, 'objetos.json');
const UPLOADS = join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT || 8000);
const REPORT_EMAIL = process.env.REPORT_EMAIL || 'ecanos2@miumg.edu.gt';
const sessions = new Map();
let store;
let writeQueue = Promise.resolve();

const stamp = () => new Date().toISOString();
const emptyStore = () => ({
  counters: { reports: 0, history: 0, claims: 0, deliveries: 0 },
  users: [{ id: 1, name: 'Administrador', username: 'admin', passwordHash: hashPassword('Campus2026!'), role: 'admin', active: true }],
  reports: [], history: [], claims: [], deliveries: []
});

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}$${pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex')}`;
}

function validPassword(password, saved) {
  const [salt, expected] = saved.split('$');
  const actual = hashPassword(password, salt).split('$')[1];
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

async function loadStore() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    store = emptyStore();
    await saveStore();
  } else store = JSON.parse(await readFile(DATA_FILE, 'utf8'));
}

function saveStore() {
  writeQueue = writeQueue.then(async () => {
    const temp = `${DATA_FILE}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2), 'utf8');
    await rename(temp, DATA_FILE);
  });
  return writeQueue;
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5_000_000) throw new Error('TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function userFrom(req) {
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8);
  return token ? sessions.get(token) : null;
}

function publicReport(r) {
  const { id, code, kind, object_type, title, public_description, image_url, event_date, event_place, status, created_at, updated_at } = r;
  return { id, code, kind, object_type, title, public_description, image_url: image_url || '', event_date, event_place, status, created_at, updated_at };
}

function addHistory(reportId, action, detail, actor) {
  store.history.push({ id: ++store.counters.history, report_id: reportId, action, detail, actor, created_at: stamp() });
}

async function notifyReport(report) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`Correo pendiente para ${REPORT_EMAIL}: configura SMTP_USER y SMTP_PASS.`);
    return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587), secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: `Encuentra UMG <${process.env.SMTP_USER}>`, to: REPORT_EMAIL,
    subject: `[${report.code}] Nuevo objeto ${report.kind === 'lost' ? 'perdido' : 'encontrado'}: ${report.title}`,
    text: `Se registró un nuevo reporte en Encuentra UMG.\n\nCódigo: ${report.code}\nTipo: ${report.kind === 'lost' ? 'Perdido' : 'Encontrado'}\nObjeto: ${report.object_type}\nTítulo: ${report.title}\nDescripción: ${report.public_description}\nFecha: ${report.event_date}\nLugar: ${report.event_place}\nCarrera: ${report.career}\nCarné: ${report.student_id}\nContacto: ${report.contact_name} · ${report.contact_value}\nEstado: ${report.status}\n\nIngresa al sistema en http://localhost:${PORT} para revisarlo.`
  });
  return { sent: true };
}

async function notifyClaim(report, claim) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`Reclamación pendiente de correo para ${REPORT_EMAIL}: configura SMTP_USER y SMTP_PASS.`);
    return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587), secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: `Encuentra UMG <${process.env.SMTP_USER}>`, to: REPORT_EMAIL,
    subject: `[${report.code}] Nueva reclamación: ${report.title}`,
    text: `Se recibió una reclamación en Encuentra UMG.\n\nCódigo del reporte: ${report.code}\nObjeto: ${report.object_type}\nTítulo: ${report.title}\nLugar: ${report.event_place}\n\nReclamante: ${claim.claimant_name}\nContacto: ${claim.claimant_contact}\nDescripción de verificación: ${claim.description}\n\nIngresa al sistema en http://localhost:${PORT}, abre el reporte y compara esta información con los detalles privados antes de aprobar la entrega.`
  });
  return { sent: true };
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
async function staticFile(pathname, res) {
  const isUpload = pathname.startsWith('/uploads/');
  const base = isUpload ? UPLOADS : STATIC;
  const requested = pathname === '/' ? 'index.html' : isUpload ? pathname.slice('/uploads/'.length) : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = join(base, safe);
  if (!file.startsWith(base)) return json(res, 404, { error: 'No encontrado' });
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-store, max-age=0' });
    res.end(content);
  } catch { json(res, 404, { error: 'No encontrado' }); }
}

async function api(req, res, url) {
  const path = url.pathname;
  const user = userFrom(req);
  const reportMatch = path.match(/^\/api\/reports\/(\d+)$/);
  const historyMatch = path.match(/^\/api\/reports\/(\d+)\/history$/);
  const claimCreateMatch = path.match(/^\/api\/reports\/(\d+)\/claims$/);
  const claimReviewMatch = path.match(/^\/api\/reports\/(\d+)\/claims\/(\d+)$/);
  const statusMatch = path.match(/^\/api\/reports\/(\d+)\/status$/);
  const photoMatch = path.match(/^\/api\/reports\/(\d+)\/photo$/);
  const deliveryMatch = path.match(/^\/api\/reports\/(\d+)\/delivery$/);

  if (req.method === 'GET' && path === '/api/session') return json(res, 200, { user: user || null });

  if (req.method === 'POST' && path === '/api/login') {
    const data = await body(req);
    const found = store.users.find(x => x.username === data.username && x.active);
    if (!found || !validPassword(data.password || '', found.passwordHash)) return json(res, 401, { error: 'Credenciales incorrectas' });
    const token = randomBytes(32).toString('base64url');
    const sessionUser = { id: found.id, name: found.name, username: found.username, role: found.role };
    sessions.set(token, sessionUser);
    return json(res, 200, { user: sessionUser }, { 'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }

  if (req.method === 'POST' && path === '/api/logout') {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('session='))?.slice(8);
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (req.method === 'GET' && path === '/api/reports') {
    let reports = [...store.reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const [param, field] of [['kind', 'kind'], ['type', 'object_type'], ['status', 'status'], ['date', 'event_date']]) {
      const value = url.searchParams.get(param); if (value) reports = reports.filter(x => x[field] === value);
    }
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (q) reports = reports.filter(x => [x.title, x.public_description, x.object_type, x.event_place].some(v => v.toLowerCase().includes(q)));
    return json(res, 200, { reports: reports.map(x => user ? x : publicReport(x)) });
  }

  if (req.method === 'POST' && path === '/api/reports') {
    const data = await body(req);
    const required = ['kind', 'object_type', 'title', 'public_description', 'event_date', 'event_place', 'career'];
    if (required.some(x => !String(data[x] || '').trim())) return json(res, 400, { error: 'Completa todos los campos obligatorios' });
    if (data.career !== 'OTROS' && !String(data.student_id || '').trim()) return json(res, 400, { error: 'El número de carné es obligatorio para estudiantes' });
    if (!['found', 'lost'].includes(data.kind)) return json(res, 400, { error: 'Tipo de reporte inválido' });
    const id = ++store.counters.reports; const created = stamp();
    let imageUrl = '';
    if (data.image_data) {
      const match = String(data.image_data).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json(res, 400, { error: 'La fotografía debe ser JPG, PNG o WEBP' });
      const image = Buffer.from(match[2], 'base64');
      if (!image.length || image.length > 3_000_000) return json(res, 400, { error: 'La fotografía no puede superar 3 MB' });
      const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
      await mkdir(UPLOADS, { recursive: true });
      const filename = `objeto-${id}-${randomBytes(6).toString('hex')}.${extension}`;
      await writeFile(join(UPLOADS, filename), image);
      imageUrl = `/uploads/${filename}`;
    }
    const report = {
      id, code: `OBJ-${created.slice(0, 4)}-${String(id).padStart(4, '0')}`, kind: data.kind,
      object_type: data.object_type.trim(), title: data.title.trim(), public_description: data.public_description.trim(),
      private_details: String(data.private_details || '').trim(), image_url: imageUrl, event_date: data.event_date, event_place: data.event_place.trim(),
      storage_place: String(data.storage_place || '').trim(), career: data.career.trim(), student_id: String(data.student_id || '').trim(), contact_name: String(data.contact_name || '').trim(),
      contact_value: String(data.contact_value || '').trim(), status: data.kind === 'found' ? 'stored' : 'reported',
      created_at: created, updated_at: created
    };
    store.reports.push(report); addHistory(id, 'Creación', `Reporte registrado con estado ${report.status}`, user?.name || 'Público'); await saveStore();
    let notification;
    try { notification = await notifyReport(report); }
    catch (error) { console.error('No se pudo enviar la notificación:', error.message); notification = { sent: false, reason: 'SEND_FAILED' }; }
    return json(res, 201, { id, code: report.code, notification });
  }

  if (req.method === 'GET' && reportMatch) {
    const found = store.reports.find(x => x.id === Number(reportMatch[1]));
    return found ? json(res, 200, { report: user ? found : publicReport(found) }) : json(res, 404, { error: 'Reporte no encontrado' });
  }

  if (req.method === 'GET' && historyMatch) {
    if (!user) return json(res, 401, { error: 'Debes iniciar sesión' });
    const id = Number(historyMatch[1]); const report = store.reports.find(x => x.id === id);
    if (!report) return json(res, 404, { error: 'Reporte no encontrado' });
    return json(res, 200, { report, history: store.history.filter(x => x.report_id === id).sort((a,b)=>b.created_at.localeCompare(a.created_at)), claims: store.claims.filter(x => x.report_id === id).sort((a,b)=>b.created_at.localeCompare(a.created_at)), delivery: store.deliveries.find(x => x.report_id === id) || null });
  }

  if (req.method === 'POST' && claimCreateMatch) {
    const id = Number(claimCreateMatch[1]); const data = await body(req);
    if (!store.reports.some(x => x.id === id)) return json(res, 404, { error: 'Reporte no encontrado' });
    if (['claimant_name', 'claimant_contact', 'description'].some(x => !String(data[x] || '').trim())) return json(res, 400, { error: 'Completa la información de la reclamación' });
    const claim = { id: ++store.counters.claims, report_id: id, claimant_name: data.claimant_name.trim(), claimant_contact: data.claimant_contact.trim(), description: data.description.trim(), status: 'pending', staff_notes: '', created_at: stamp(), reviewed_at: '' };
    store.claims.push(claim);
    addHistory(id, 'Reclamación', 'Se recibió una solicitud de reclamación', 'Público'); await saveStore();
    const report = store.reports.find(x => x.id === id); let notification;
    try { notification = await notifyClaim(report, claim); }
    catch (error) { console.error('No se pudo enviar la notificación de reclamación:', error.message); notification = { sent: false, reason: 'SEND_FAILED' }; }
    return json(res, 201, { ok: true, notification });
  }

  if (!user && (statusMatch || photoMatch || claimReviewMatch || deliveryMatch)) return json(res, 401, { error: 'Debes iniciar sesión' });

  if (req.method === 'PATCH' && photoMatch) {
    const id = Number(photoMatch[1]); const data = await body(req); const report = store.reports.find(x => x.id === id);
    if (!report) return json(res, 404, { error: 'Reporte no encontrado' });
    const match = String(data.image_data || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(res, 400, { error: 'Selecciona una fotografía JPG, PNG o WEBP' });
    const image = Buffer.from(match[2], 'base64');
    if (!image.length || image.length > 3_000_000) return json(res, 400, { error: 'La fotografía no puede superar 3 MB' });
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    await mkdir(UPLOADS, { recursive: true });
    const filename = `objeto-${id}-${randomBytes(6).toString('hex')}.${extension}`;
    await writeFile(join(UPLOADS, filename), image);
    report.image_url = `/uploads/${filename}`; report.updated_at = stamp();
    addHistory(id, 'Fotografía', 'Se agregó o actualizó la fotografía del reporte', user.name);
    await saveStore(); return json(res, 200, { ok: true, image_url: report.image_url });
  }

  if (req.method === 'PATCH' && statusMatch) {
    const id = Number(statusMatch[1]); const data = await body(req); const labels = { reported: 'Reportado', stored: 'Resguardado', claimed: 'Reclamado', delivered: 'Entregado' };
    const report = store.reports.find(x => x.id === id); if (!report) return json(res, 404, { error: 'Reporte no encontrado' });
    if (!labels[data.status]) return json(res, 400, { error: 'Estado inválido' });
    report.status = data.status; report.updated_at = stamp(); addHistory(id, 'Cambio de estado', `Estado actualizado a ${labels[data.status]}`, user.name); await saveStore(); return json(res, 200, { ok: true });
  }

  if (req.method === 'PATCH' && claimReviewMatch) {
    const id = Number(claimReviewMatch[1]), claimId = Number(claimReviewMatch[2]), data = await body(req);
    if (!['approved', 'rejected'].includes(data.status)) return json(res, 400, { error: 'Resultado inválido' });
    const claim = store.claims.find(x => x.id === claimId && x.report_id === id); if (!claim) return json(res, 404, { error: 'Reclamación no encontrada' });
    claim.status = data.status; claim.staff_notes = String(data.staff_notes || '').trim(); claim.reviewed_at = stamp();
    if (data.status === 'approved') { const report = store.reports.find(x => x.id === id); report.status = 'claimed'; report.updated_at = stamp(); }
    addHistory(id, 'Verificación', `Reclamación ${data.status === 'approved' ? 'aprobada' : 'rechazada'}`, user.name); await saveStore(); return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && deliveryMatch) {
    const id = Number(deliveryMatch[1]); const data = await body(req); const report = store.reports.find(x => x.id === id);
    if (!report) return json(res, 404, { error: 'Reporte no encontrado' });
    if (store.deliveries.some(x => x.report_id === id)) return json(res, 409, { error: 'La entrega ya fue registrada' });
    if (!String(data.recipient_name || '').trim()) return json(res, 400, { error: 'Indica quién recibe el objeto' });
    store.deliveries.push({ id: ++store.counters.deliveries, report_id: id, recipient_name: data.recipient_name.trim(), recipient_document: String(data.recipient_document || '').trim(), responsible: user.name, notes: String(data.notes || '').trim(), delivered_at: stamp() });
    report.status = 'delivered'; report.updated_at = stamp(); addHistory(id, 'Entrega', `Entregado a ${data.recipient_name.trim()}`, user.name); await saveStore(); return json(res, 201, { ok: true });
  }

  return json(res, 404, { error: 'Ruta no encontrada' });
}

await loadStore();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(req, res, url); else await staticFile(url.pathname, res);
  } catch (error) {
    console.error(error);
    json(res, error.message === 'TOO_LARGE' ? 413 : 400, { error: error.message === 'TOO_LARGE' ? 'Solicitud demasiado grande' : 'Solicitud inválida' });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Encuentra UMG disponible en http://localhost:${PORT}`));
