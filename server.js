import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || 'v24.0';
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.enc.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const MASTER_KEY_RAW = process.env.MASTER_KEY || '';

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ ok:false, error:'ADMIN_KEY is not configured on the server.' });
  const key = req.get('x-admin-key') || req.body?.adminKey || req.query?.adminKey || '';
  const a = crypto.createHash('sha256').update(String(key)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }
  next();
}

function masterKey() {
  if (!MASTER_KEY_RAW) throw new Error('MASTER_KEY is not configured.');
  return crypto.createHash('sha256').update(MASTER_KEY_RAW).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: ciphertext.toString('base64url') };
}

function decrypt(obj) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(obj.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(obj.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(obj.data, 'base64url')), decipher.final()]).toString('utf8');
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return JSON.parse(decrypt(parsed));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function saveSettings(settings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = encrypt(JSON.stringify(settings));
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(payload), { mode: 0o600 });
}

function safeSettings(s) {
  return { pageId: s.pageId || '', verifyTokenSet: Boolean(s.verifyToken), accessTokenSet: Boolean(s.accessToken), graphApiVersion: GRAPH_API_VERSION };
}

app.get('/api/health', (_req,res)=>res.json({ok:true, service:'messenger-web-tester'}));

app.get('/api/settings', requireAdmin, async (_req,res)=>{
  try { res.json({ok:true, settings:safeSettings(await loadSettings())}); }
  catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/settings', requireAdmin, async (req,res)=>{
  try {
    const current = await loadSettings();
    const next = {
      pageId: String(req.body.pageId || '').trim(),
      verifyToken: req.body.verifyToken ? String(req.body.verifyToken) : current.verifyToken || '',
      accessToken: req.body.accessToken ? String(req.body.accessToken) : current.accessToken || ''
    };
    if (!next.pageId || !next.verifyToken || !next.accessToken) return res.status(400).json({ok:false,error:'กรุณาระบุ Page ID, Verify Token และ Page Access Token ให้ครบ'});
    await saveSettings(next);
    res.json({ok:true,settings:safeSettings(next)});
  } catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

app.post('/api/settings/clear', requireAdmin, async (_req,res)=>{
  try { await fs.rm(SETTINGS_FILE,{force:true}); res.json({ok:true}); }
  catch(e) { res.status(500).json({ok:false,error:e.message}); }
});

async function graphRequest(url, options={}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw:text }; }
  if (!response.ok) {
    const msg = data?.error?.message || `Graph API HTTP ${response.status}`;
    const err = new Error(msg); err.status=response.status; err.graph=data; throw err;
  }
  return data;
}

app.post('/api/messenger/test', requireAdmin, async (req,res)=>{
  try {
    const s = await loadSettings();
    const recipientId = String(req.body.recipientId || '').trim();
    const message = String(req.body.message || '').trim();
    if (!s.pageId || !s.accessToken) return res.status(400).json({ok:false,error:'ยังไม่ได้ตั้งค่า Messenger connection'});
    if (!recipientId || !message) return res.status(400).json({ok:false,error:'ต้องมี Recipient PSID และข้อความ'});
    if (message.length > 2000) return res.status(400).json({ok:false,error:'ข้อความยาวเกิน 2000 ตัวอักษร'});
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(s.pageId)}/messages?access_token=${encodeURIComponent(s.accessToken)}`;
    const data = await graphRequest(url, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({recipient:{id:recipientId},message:{text:message}}) });
    res.json({ok:true,data});
  } catch(e) { res.status(e.status || 500).json({ok:false,error:e.message,graph:e.graph?.error || undefined}); }
});

// Messenger webhook verification.
app.get('/webhook', async (req,res)=>{
  try {
    const s = await loadSettings();
    const mode=req.query['hub.mode']; const token=req.query['hub.verify_token']; const challenge=req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === s.verifyToken) return res.status(200).send(challenge);
    return res.sendStatus(403);
  } catch { return res.sendStatus(403); }
});

// Messenger webhook receiver. Acknowledge quickly; do not expose access tokens.
app.post('/webhook', async (req,res)=>{
  res.sendStatus(200);
  const body=req.body;
  if (body?.object !== 'page') return;
  try {
    await fs.mkdir(DATA_DIR,{recursive:true});
    const line = JSON.stringify({receivedAt:new Date().toISOString(), body});
    await fs.appendFile(path.join(DATA_DIR,'webhook.log'), line+'\n');
  } catch {}
});

app.use((_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log(`Messenger web tester listening on :${PORT}`));
