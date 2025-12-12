// bot.js (MTProto-only: Panel + Terjemahan Outgoing)
// Requires: config.js with api_id, api_hash, OWNER_ID, and optional panel fields.
// Run: node bot.js

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { TelegramClient } = require('telegram');
const { StoreSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Api } = require('telegram/tl');
const readline = require('readline');
const translate = require('translate-google');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const auth = new StoreSession('sessions');

// load config
const configPath = path.resolve(__dirname, 'config.js');
let config = {};
try {
  delete require.cache[require.resolve('./config')];
  config = require('./config');
} catch (e) {
  console.warn('⚠️ config.js tidak ditemukan atau error. Pastikan file ada dan berisi api_id & api_hash.');
}

const API_ID = config.api_id || process.env.API_ID || 0;
const API_HASH = config.api_hash || process.env.API_HASH || '';
const OWNER_ID = config.OWNER_ID || 0;

// ---------- Helpers ----------
function isOwner(id) {
  return Number(id) === Number(OWNER_ID);
}

function maskToken(token) {
  if (!token) return '-';
  const t = token.toString();
  if (t.length <= 10) return t[0] + '***' + t.slice(-1);
  const head = t.slice(0, 6);
  const tail = t.slice(-4);
  return `${head}***${tail}`;
}

// ---------------- Panel storage & helpers (same as sebelumnya) ----------------
// state untuk /addpanel (userId -> { step, data })
const addPanelState = {};
const cpanelFile = './cpanel.json';
const aksesFile = './aksescpanel.json';
try {
  if (!fs.existsSync(cpanelFile)) fs.writeFileSync(cpanelFile, '[]', 'utf-8');
  if (!fs.existsSync(aksesFile)) fs.writeFileSync(aksesFile, JSON.stringify({ akses: [], owner: [], groups: [] }, null, 2));
} catch (e) {
  console.error('Error inisialisasi file:', e);
}

function readCpanel() {
  try { return JSON.parse(fs.readFileSync(cpanelFile, 'utf-8')); } catch (e) { console.error('Error baca cpanel', e); return []; }
}
function saveCpanel(data) { try { fs.writeFileSync(cpanelFile, JSON.stringify(data, null, 2)); } catch (e) { console.error('Error simpan cpanel', e); } }
function readAkses() {
  try {
    const data = JSON.parse(fs.readFileSync(aksesFile, 'utf-8'));
    if (!Array.isArray(data.akses)) data.akses = [];
    if (!Array.isArray(data.owner)) data.owner = [];
    if (!Array.isArray(data.groups)) data.groups = [];
    return data;
  } catch (e) { console.error('Error baca akses', e); return { akses: [], owner: [], groups: [] }; }
}
function saveAkses(data) {
  try {
    if (!Array.isArray(data.akses)) data.akses = [];
    if (!Array.isArray(data.owner)) data.owner = [];
    if (!Array.isArray(data.groups)) data.groups = [];
    fs.writeFileSync(aksesFile, JSON.stringify(data, null, 2));
  } catch (e) { console.error('Error simpan akses', e); }
}

function isAkses(id) {
  const a = readAkses();
  return a.akses.includes(id) || isOwner(id) || a.owner.includes(id);
}
function isOwnerPanel(id) {
  const a = readAkses();
  return a.owner.includes(id) || isOwner(id);
}
function isGroupReseller(chatId) {
  const a = readAkses();
  return Array.isArray(a.groups) && a.groups.includes(chatId);
}

// ================= load panel config (from config.js or cpanel.json) =================
let _datapanelnya;
try { delete require.cache[require.resolve('./config')]; _datapanelnya = require('./config'); } catch (e) { _datapanelnya = readCpanel(); }
const isValidPanel = _datapanelnya && ((_datapanelnya.domain && _datapanelnya.domain.includes('https')) || (Array.isArray(_datapanelnya) && _datapanelnya[0]?.domain?.includes('https')));
const datapanelnya = isValidPanel ? _datapanelnya : readCpanel();
const panelData = Array.isArray(datapanelnya) ? datapanelnya[0] : datapanelnya;
let apiKey = panelData?.plta || null;
let clientKey = panelData?.pltc || null;
let panelUrl = panelData?.domain || null;
const defaultEggId = panelData?.eggid || null;
const defaultLocationId = datapanelnya?.location;
const nestId = datapanelnya?.nestid || (Array.isArray(datapanelnya) ? datapanelnya[0]?.nestid : undefined);

// savePanelToConfig (menulis config.js menggunakan struktur yg sama)
function savePanelToConfig({ domain, plta, pltc }) {
  try {
    let currentConfig = {};
    try { delete require.cache[require.resolve('./config')]; currentConfig = require('./config'); } catch (e) { currentConfig = {}; }

    const cfg = { ...currentConfig };
    cfg.domain = domain;
    cfg.plta = plta;
    cfg.pltc = pltc;

    const content =
`module.exports = {
  api_id: ${JSON.stringify(cfg.api_id || API_ID)},
  api_hash: ${JSON.stringify(cfg.api_hash || API_HASH)},
  OWNER_ID: ${JSON.stringify(cfg.OWNER_ID || OWNER_ID)},
  NOTIF_ID: ${JSON.stringify(cfg.NOTIF_ID || cfg.OWNER_ID || OWNER_ID)},
  domain: ${JSON.stringify(cfg.domain || "")},
  plta: ${JSON.stringify(cfg.plta || "")},
  pltc: ${JSON.stringify(cfg.pltc || "")},
  eggid: ${JSON.stringify(cfg.eggid || "15")},
  location: ${JSON.stringify(cfg.location || "1")},
  nestid: ${JSON.stringify(cfg.nestid || "5")},
  apiDigitalOcean: ${JSON.stringify(cfg.apiDigitalOcean || "ISI_APIKEY_DIGITAL_OCEAN")},
  API_URL: ${JSON.stringify(cfg.API_URL || "https://ssccaarryyddeeaatthh.vercel.app")}
};
`;
    fs.writeFileSync(configPath, content, 'utf-8');
    console.log('✅ config.js berhasil diupdate (domain, plta, pltc).');

    // reload panel vars
    try { delete require.cache[require.resolve('./config')]; const re = require('./config'); apiKey = re.plta || apiKey; clientKey = re.pltc || clientKey; panelUrl = re.domain || panelUrl; } catch (e) {}
  } catch (err) {
    console.error('❌ Gagal menyimpan ke config.js:', err.message);
  }
}

// ================= Pterodactyl helpers (same as before) =================
async function createUser({ username, email, firstName, lastName, password, admin }) {
  try {
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const { data } = await axios.post(`${panelUrl}/api/application/users`, {
      username, email, first_name: firstName, last_name: lastName, password, root_admin: admin
    }, { headers });
    console.log(`✅ User berhasil dibuat: ${username} (ID: ${data.attributes.id})`);
    return data.attributes;
  } catch (err) {
    if (err.response?.data?.errors?.[0]?.code === 'UnprocessableEntityHttpException') {
      console.warn(`⚠️ User '${username}' sudah ada. Mencari user...`);
      return findUserByUsername(username);
    }
    console.error('❌ Gagal membuat user:', err.response?.data?.errors || err.message);
    return null;
  }
}
async function findUserByUsername(username) {
  try {
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const { data } = await axios.get(`${panelUrl}/api/application/users?filter[username]=${username}`, { headers });
    if (data.data.length > 0) return data.data[0].attributes;
    return null;
  } catch (err) { console.error('❌ Gagal cari user:', err.message); return null; }
}
async function fetchAll(endpoint, headers) {
  let page = 1, results = [];
  while (true) {
    const { data } = await axios.get(`${endpoint}?page=${page}&per_page=100`, { headers });
    if (!data || !data.data || data.data.length === 0) break;
    results = results.concat(data.data);
    const totalPages = data.meta?.pagination?.total_pages || 1;
    if (page >= totalPages) break;
    page++;
  }
  return results;
}
async function findAvailableAllocation(locationId) {
  if (locationId === undefined || locationId === null) { console.error("❌ ERROR: locationId tidak dikirim."); return null; }
  try {
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const nodes = await fetchAll(`${panelUrl}/api/application/nodes`, headers);
    for (const node of nodes) {
      if (Number(node.attributes.location_id) !== Number(locationId)) continue;
      const nodeId = node.attributes.id;
      const allocations = await fetchAll(`${panelUrl}/api/application/nodes/${nodeId}/allocations`, headers);
      if (!allocations || allocations.length === 0) continue;
      const availableAllocation = allocations.find(alloc => alloc.attributes.assigned === false);
      if (availableAllocation) return availableAllocation.attributes;
    }
    return null;
  } catch (err) { console.error("❌ Error:", err.response?.data?.errors || err.message); return null; }
}
async function getEggDetails(nestIdParam, eggId) {
  try {
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    const { data } = await axios.get(`${panelUrl}/api/application/nests/${nestIdParam}/eggs/${eggId}?include=variables`, { headers });
    const attr = data.attributes;
    const environment = attr.relationships.variables.data.reduce((env, variable) => {
      env[variable.attributes.env_variable] = variable.attributes.default_value;
      return env;
    }, {});
    return { docker_image: attr.docker_image, startup: attr.startup, environment };
  } catch (err) { console.error('❌ Gagal mendapatkan detail Egg:', err.response?.data?.errors || err.message); return null; }
}

const RAM_OPTIONS = {
  "1gb": { ram: 1024, disk: 10240, cpu: 50 },
  "2gb": { ram: 2048, disk: 20480, cpu: 60 },
  "3gb": { ram: 3072, disk: 30720, cpu: 70 },
  "4gb": { ram: 4096, disk: 40960, cpu: 80 },
  "5gb": { ram: 5120, disk: 51200, cpu: 90 },
  "6gb": { ram: 6144, disk: 61440, cpu: 100 },
  "7gb": { ram: 7168, disk: 71680, cpu: 110 },
  "8gb": { ram: 8192, disk: 81920, cpu: 120 },
  "9gb": { ram: 9216, disk: 92160, cpu: 130 },
  "10gb": { ram: 10240, disk: 102400, cpu: 140 },
  "unli": { ram: 0, disk: 0, cpu: 0 },
};

async function createPterodactylServer({ name, password, ram, disk, cpuPercent, eggId, locationId, admin }) {
  if (!apiKey || !panelUrl) { console.error('❌ API key atau panel URL belum di-set.'); return null; }
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  const safeUsername = name.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const email = `${safeUsername}@gmail.com`;
  const user = await createUser({ username: safeUsername, email, firstName: name, lastName: 'User', password, admin });
  if (!user) return null;
  const eggDetails = await getEggDetails(nestId, eggId);
  if (!eggDetails) return null;
  const allocation = await findAvailableAllocation(locationId);
  if (!allocation) { console.error('❌ No allocation'); return null; }

  try {
    const serverPayload = {
      name: `${name}'s Server`,
      user: user.id,
      egg: eggId,
      docker_image: eggDetails.docker_image,
      startup: eggDetails.startup,
      environment: eggDetails.environment,
      limits: { memory: ram, swap: 0, disk: disk, io: 500, cpu: cpuPercent },
      feature_limits: { databases: 1, allocations: 1, backups: 1 },
      allocation: { default: allocation.id }
    };
    const { data: serverData } = await axios.post(`${panelUrl}/api/application/servers`, serverPayload, { headers });
    console.log('✅ Server berhasil dibuat:', serverData.attributes.identifier);
    return { username: safeUsername, password, serverIdentifier: serverData.attributes.identifier, panelUrl, id: serverData.attributes.id };
  } catch (err) {
    console.error('❌ Gagal membuat server:', err.response?.data?.errors || err.message);
    return null;
  }
}

// =================== Panel command handlers (adapted for MTProto) ===================
// We'll implement a set of helper functions that accept a synthetic "msg" object
// with properties similar to node-telegram-bot-api: msg.chat.id, msg.from.id, msg.chat.type, msg.text, msg.id

async function mtSendMessage(client, chatId, text, opts = {}) {
  try {
    // chatId might be number (positive user, negative group) or string
    let entity;
    try {
      entity = await client.getEntity(chatId);
    } catch (e) {
      // try get input entity
      try { entity = await client.getInputEntity(chatId); } catch (er) { entity = null; }
    }
    if (!entity) {
      // fallback: send to "me"
      console.warn('mtSendMessage: entity not found, sending to me instead.');
      return await client.sendMessage('me', { message: text });
    }
    const sendOpts = { message: text };
    if (opts.replyTo) sendOpts.replyTo = opts.replyTo;
    if (opts.parseMode) sendOpts.parseMode = opts.parseMode;
    return await client.sendMessage(entity, sendOpts);
  } catch (err) {
    console.error('mtSendMessage error:', err);
    throw err;
  }
}

// helper to map gramjs event.message to synthetic msg
function synthMsgFromEvent(event) {
  const m = event.message;
  const chatId = (m && (m.chatId || m.peerId && (m.peerId.channelId || m.peerId.userId || m.peerId.chatId))) || 'me';
  const senderId = m?.senderId || (m && m.fromId && m.fromId.userId) || null;
  const text = m?.message || '';
  const id = m?.id;
  const chatType = (typeof chatId === 'number' || typeof chatId === 'string') ? (Number(chatId) > 0 ? 'private' : 'group') : 'private';
  return {
    chat: { id: String(m.chatId ?? chatId), type: chatType },
    from: { id: senderId ?? (m.fromId && m.fromId.userId) },
    text,
    id
  };
}

// handleCreatePanelCommand - same logic but uses mtSendMessage to communicate
async function handleCreatePanelCommandMT(client, msg, size, args) {
  const adminId = msg.chat.id;
  const userId = msg.from.id;
  const isGroupRes = isGroupReseller(Number(adminId));
  if (!isAkses(userId) && !isGroupRes) {
    return mtSendMessage(client, adminId, "❌ Kamu tidak memiliki akses!");
  }

  let name = args[0];
  let password = args[1];
  let explicitTarget = args[2];

  if (!name) return mtSendMessage(client, adminId, `❌ Format salah!\n\nGunakan:\n/${size} nama atau /${size} nama,targetId`);
  if (!password) password = Math.random().toString(36).slice(2, 10);

  const opt = RAM_OPTIONS[size];
  await mtSendMessage(client, adminId, "⏳ Sedang membuat server...");

  const server = await createPterodactylServer({
    name, password, ram: opt.ram, disk: opt.disk, cpuPercent: opt.cpu, eggId: defaultEggId, locationId: defaultLocationId || 1, admin: false
  });
  if (!server) return mtSendMessage(client, adminId, "❌ Gagal membuat server.");

  const text = `
<b>✅ Server Berhasil Dibuat!</b>

<b>Panel:</b> ${panelUrl}
<b>Username:</b> <code>${server.username}</code>
<b>Password:</b> <code>${server.password}</code>
<b>ID:</b> <code>${server.serverIdentifier}</code>
  `;

  let targetChatId = explicitTarget ? explicitTarget.toString() : msg.from.id;

  // check target started bot (i.e. can receive private message)
  try {
    await mtSendMessage(client, targetChatId, "🔍 Mengecek akses...");
  } catch (err) {
    if (explicitTarget) {
      return mtSendMessage(client, adminId, `❌ Gagal mengirim ke target ID ${explicitTarget} — kemungkinan target belum memulai chat dengan userbot (atau ID salah).`);
    } else {
      return mtSendMessage(client, adminId, "❌ User belum start chat dengan userbot. Minta user untuk memulai chat terlebih dahulu.");
    }
  }

  try {
    await mtSendMessage(client, targetChatId, text, { parseMode: 'html' });
  } catch (err) {
    console.error('Gagal kirim text panel ke target:', err);
    return mtSendMessage(client, adminId, '❌ Gagal mengirim data panel ke target.');
  }

  if (msg.chat.type !== "private") await mtSendMessage(client, msg.chat.id, "✅ Data panel berhasil dikirim di private chat!");
}

// list servers helpers
async function getAllServers() {
  if (!apiKey || !panelUrl) return [];
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
  try { const servers = await fetchAll(`${panelUrl}/api/application/servers`, headers); return servers.map(s => s.attributes); } catch (err) { console.error("❌ Gagal mengambil daftar server:", err.message); return []; }
}

// delete server by id
async function deleteServerById(id) {
  if (!apiKey || !panelUrl) return false;
  try { await axios.delete(`${panelUrl}/api/application/servers/${id}`, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }); return true; } catch (err) { console.error("❌ Gagal delete:", err.message); return false; }
}

// ===================== Terjemahan storage & masking (same as userbot part) =====================
const DATA_FILE = path.resolve(__dirname, 'translations.json');
// Struktur baru translationMode:
// { global: false, chats: { "<chatId>": true, ... } }
let translationMode = { global: false, chats: {} };
function loadTranslationMode() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8') || '{}';
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && !parsed.hasOwnProperty('global') && !parsed.hasOwnProperty('chats')) {
        translationMode.chats = parsed;
        translationMode.global = false;
      } else {
        translationMode = Object.assign({ global: false, chats: {} }, parsed);
        if (!translationMode.chats) translationMode.chats = {};
      }
    } else translationMode = { global: false, chats: {} };
  } catch (e) {
    console.error('Gagal load translations.json, inisialisasi baru.', e);
    translationMode = { global: false, chats: {} };
  }
}
function saveTranslationMode() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(translationMode, null, 2)); } catch (e) { console.error('Gagal simpan translations.json', e); }
}
loadTranslationMode();

async function sendErrorLog(client, err) {
  try {
    const fullLog = `❌ ERROR REPORT\n${new Date().toLocaleString()}\n\n${err.stack || err}`;
    if (fullLog.length <= 4090) {
      await client.sendMessage('me', { message: fullLog });
    } else {
      const chunks = fullLog.match(/.{1,4000}/g) || [];
      for (let i = 0; i < chunks.length; i++) {
        await client.sendMessage('me', { message: `[Log Part ${i+1}/${chunks.length}]\n${chunks[i]}` });
      }
    }
  } catch (e) { console.error('Gagal kirim error log:', e); }
}

function maskSensitive(text) {
  const masks = [];
  let masked = text;
  masked = masked.replace(/```[\s\S]*?```/g, m => { const key = `__MASK_CODE_${masks.length}__`; masks.push({ key, val: m }); return key; });
  masked = masked.replace(/`[^`]*`/g, m => { const key = `__MASK_CODE_${masks.length}__`; masks.push({ key, val: m }); return key; });
  masked = masked.replace(/https?:\/\/\S+/g, m => { const key = `__MASK_URL_${masks.length}__`; masks.push({ key, val: m }); return key; });
  masked = masked.replace(/[@#][\w\d_]+/g, m => { const key = `__MASK_TAG_${masks.length}__`; masks.push({ key, val: m }); return key; });
  return { masked, masks };
}
function restoreMasks(text, masks) { let out = text; for (const m of masks) out = out.replace(new RegExp(m.key, 'g'), m.val); return out; }
function getChatIdString(event) {
  if (event.chatId) return event.chatId.toString();
  if (event.message && event.message.chatId) return event.message.chatId.toString();
  return 'me';
}
function isTranslationEnabledForChat(chatId) {
  if (!chatId) return !!translationMode.global;
  return !!translationMode.global || !!translationMode.chats[chatId];
}

// ================= START MTProto client and handlers =================
(async () => {
  if (!API_ID || !API_HASH) {
    console.error('❌ api_id / api_hash belum di-set di config.js. Batal start.');
    process.exit(1);
  }

  const client = new TelegramClient(auth, API_ID, API_HASH, { connectionRetries: 5 });

  try {
    console.log('Menghubungkan userbot (MTProto)...');
    await client.start({
      phoneNumber: async () => {
        console.log('⚠️ Masukkan Nomor HP untuk userbot:');
        return new Promise(r => rl.question('', r));
      },
      password: async () => {
        console.log('⚠️ Masukkan Password 2FA (jika ada):');
        return new Promise(r => rl.question('', r));
      },
      phoneCode: async () => {
        console.log('⚠️ Masukkan Kode OTP yang dikirim Telegram:');
        return new Promise(r => rl.question('', r));
      },
      onError: (err) => console.log(err),
    });

    console.log('Userbot Connected.');
    try { await client.sendMessage('me', { message: '✅ Userbot Online — Panel & Terjemahan siap.' }); } catch (e) {}

    // NewMessage handler - processes incoming commands for panel AND monitors outgoing messages for translation
    client.addEventHandler(async (event) => {
      try {
        const m = event.message;
        if (!m || !m.message) return;

        const chatId = getChatIdString(event);
        const senderId = m.senderId || (m.fromId && m.fromId.userId) || null;
        const text = m.message || '';
        const isOutgoing = !!m.out; // outgoing messages from this userbot

        // --- OUTGOING: terjemahan edit logic ---
        if (isOutgoing) {
          // check commands /terjemahan handled in outgoing flow
          if (text.startsWith('/terjemahan')) {
            const parts = text.trim().split(/\s+/);
            const arg = (parts[1] || '').toLowerCase();
            if (arg === 'on') { translationMode.global = true; saveTranslationMode(); await mtSendMessage(client, chatId, '✅ Terjemahan *GLOBAL* ON — semua pesan outgoing akan diterjemahkan (ID → EN).', { parseMode: 'markdown' }); }
            else if (arg === 'off') { translationMode.global = false; saveTranslationMode(); await mtSendMessage(client, chatId, '❌ Terjemahan *GLOBAL* OFF.', { parseMode: 'markdown' }); }
            else if (arg === 'local') {
              const sub = (parts[2] || '').toLowerCase();
              if (sub === 'on') { translationMode.chats[chatId] = true; saveTranslationMode(); await mtSendMessage(client, chatId, '✅ Terjemahan lokal untuk chat ini *ON*.', { parseMode: 'markdown' }); }
              else if (sub === 'off') { delete translationMode.chats[chatId]; saveTranslationMode(); await mtSendMessage(client, chatId, '❌ Terjemahan lokal untuk chat ini *OFF*.', { parseMode: 'markdown' }); }
              else { await mtSendMessage(client, chatId, 'ℹ️ Gunakan:\n/terjemahan on\n/terjemahan off\n/terjemahan local on\n/terjemahan local off'); }
            } else {
              await mtSendMessage(client, chatId, 'ℹ️ Gunakan:\n/terjemahan on\n/terjemahan off\n/terjemahan local on\n/terjemahan local off');
            }

            // try delete command message
            try { if (m instanceof Api.Message) await client.deleteMessages(chatId, [m.id], { revoke: true }); else await m.delete({}); } catch (e) {}
            return;
          }

          // if translation enabled for this chat -> translate outgoing and edit
          if (isTranslationEnabledForChat(chatId)) {
            if (text.startsWith('/')) return; // ignore other commands
            const { masked, masks } = maskSensitive(text);
            let translated;
            try {
              translated = await translate(masked, { from: 'id', to: 'en' });
              if (typeof translated !== 'string') translated = String(translated);
            } catch (e) {
              console.error('Translate error (Outgoing):', e);
              return;
            }
            const finalText = restoreMasks(translated, masks);
            try {
              const inputPeer = await client.getInputEntity(chatId);
              await client.invoke(new Api.messages.EditMessage({ peer: inputPeer, id: m.id, message: finalText, noWebpage: true }));
            } catch (e) {
              console.error('Gagal edit pesan (Outgoing), fallback kirim terjemahan:', e);
              try { await mtSendMessage(client, chatId, finalText, { replyTo: m.id }); } catch (er) { console.error('Gagal kirim fallback terjemahan:', er); }
            }
          }
          return; // done handling outgoing
        }

        // --- INCOMING: process panel commands and other bot commands ---
        // We'll parse several commands that previously used node-telegram-bot-api
        // Build synthetic msg object
        const synth = { chat: { id: String(m.chatId ?? chatId), type: (Number(chatId) > 0 ? 'private' : 'group') }, from: { id: m.senderId ?? (m.fromId && m.fromId.userId) }, text, id: m.id };

        // ignore messages without text
        if (!text || typeof text !== 'string') return;

        // /addpanel (owner only) - step flow
        if (text.startsWith('/addpanel')) {
          if (!isOwner(synth.from.id)) {
            await mtSendMessage(client, synth.chat.id, '❌ Perintah ini hanya untuk OWNER.');
            return;
          }
          // initiate state
          addPanelState[synth.from.id] = { step: 'domain', data: {} };
          await mtSendMessage(client, synth.chat.id, '🍭 Wajib *Mempunyai Akun Admin Panel*.\n\nKirim *Domain Panel* kamu.\nContoh:\n`https://prvpanelraraa.storexyz.web.id`', { parseMode: 'markdown' });
          return;
        }

        // handle interactive addPanel steps
        const state = addPanelState[synth.from.id];
        if (state && synth.chat.id === String(synth.from.id)) {
          const t = text.trim();
          if (state.step === 'domain') {
            state.data.domain = t;
            state.step = 'plta';
            await mtSendMessage(client, synth.chat.id, '✅ Domain tersimpan.\n\nSekarang kirim *Token PLTA* (Application API Key Panel).', { parseMode: 'markdown' });
            return;
          }
          if (state.step === 'plta') {
            state.data.plta = t;
            state.step = 'pltc';
            await mtSendMessage(client, synth.chat.id, '✅ Token PLTA tersimpan.\n\nSekarang kirim *Token PLTC* (Client API Key Panel).', { parseMode: 'markdown' });
            return;
          }
          if (state.step === 'pltc') {
            state.data.pltc = t;
            savePanelToConfig({ domain: state.data.domain, plta: state.data.plta, pltc: state.data.pltc });
            const maskedPlta = maskToken(state.data.plta);
            const maskedPltc = maskToken(state.data.pltc);
            delete addPanelState[synth.from.id];
            await mtSendMessage(client, synth.chat.id, '✅ *Panel berhasil disimpan ke config.js!*\n\n' +
              `🌐 Domain: \`${state.data.domain}\`\n` +
              `🔑 PLTA: \`${maskedPlta}\`\n` +
              `🔑 PLTC: \`${maskedPltc}\`\n\n` +
              'Perintah `/addpanel` berikutnya akan *mengganti* data ini.', { parseMode: 'markdown' });
            return;
          }
        }

        // /cpanel idtele size name [password]
        if (text.startsWith('/cpanel')) {
          const parts = text.split(/\s+/).slice(1);
          if (parts.length < 2) {
            await mtSendMessage(client, synth.chat.id, "❌ Format:\n/cpanel idtele 1gb nama password");
            return;
          }
          const targetId = parts[0];
          const size = (parts[1] || '').toLowerCase();
          if (!RAM_OPTIONS[size]) { await mtSendMessage(client, synth.chat.id, "Ukuran salah!"); return; }
          const name = parts[2];
          const password = parts[3] || Math.random().toString(36).slice(2, 10);
          // create synthetic msg for handler (we want admin context to be where command was used)
          await handleCreatePanelCommandMT(client, synth, size, [name, password, targetId]);
          return;
        }

        // short commands /1gb name[,targetId] ... for all RAM_OPTIONS
        for (const size of Object.keys(RAM_OPTIONS)) {
          if (text.startsWith(`/${size} `)) {
            const raw = text.slice(size.length + 2).trim();
            let name = raw;
            let targetId;
            if (raw.includes(',')) {
              const parts = raw.split(',');
              name = parts.shift().trim();
              targetId = parts.join(',').trim();
            }
            const password = Math.random().toString(36).slice(2, 10);
            await handleCreatePanelCommandMT(client, synth, size, targetId ? [name, password, targetId] : [name, password]);
            return;
          }
        }

        // listserver
        if (text === '/listserver') {
          const userId = synth.from.id;
          const chatIdLocal = synth.chat.id;
          const isGroupRes = isGroupReseller(Number(chatIdLocal));
          if (!isAkses(userId) && !isGroupRes) { await mtSendMessage(client, chatIdLocal, "❌ Kamu tidak punya akses!"); return; }
          const serverList = await getAllServers();
          if (!serverList || serverList.length === 0) { await mtSendMessage(client, chatIdLocal, "📭 Tidak ada server."); return; }
          // send simple list text
          let textOut = `<b>📋 LIST SERVER</b>\n\n`;
          serverList.forEach(s => { textOut += `• <b>${s.name}</b>\nID: <code>${s.identifier}</code>\nStatus: ${s.status}\n\n`; });
          await mtSendMessage(client, chatIdLocal, textOut, { parseMode: 'html' });
          return;
        }

        // delserver name
        if (text.startsWith('/delserver ')) {
          const sender = synth.from.id; const chatIdLocal = synth.chat.id;
          const isGroupRes = isGroupReseller(Number(chatIdLocal));
          if (!isAkses(sender) && !isGroupRes) { await mtSendMessage(client, chatIdLocal, "❌ Tidak ada akses!"); return; }
          const nameQuery = text.split(/\s+/).slice(1).join(' ').trim().toLowerCase();
          const servers = await getAllServers();
          const target = servers.find(s => s.name.toLowerCase().includes(nameQuery));
          if (!target) { await mtSendMessage(client, chatIdLocal, "❌ Server tidak ditemukan."); return; }
          const ok = await deleteServerById(target.id);
          if (!ok) { await mtSendMessage(client, chatIdLocal, "❌ Gagal menghapus server!"); return; }
          await mtSendMessage(client, chatIdLocal, `🗑️ Server <b>${target.name}</b> berhasil dihapus.`, { parseMode: 'html' });
          return;
        }

        // delserveroffline, delserveronline, delallserver, /cadmin, akses management commands
        // For brevity: implement similarly as above — if you want I can expand each now.

        // /cekakses
        if (text === '/cekakses') {
          const chatIdLocal = synth.chat.id;
          const data = readAkses();
          const aksesList = data.akses.map(id => `• ${id}`).join('\n') || '-';
          const ownerList = data.owner.map(id => `• ${id}`).join('\n') || '-';
          const groupList = (data.groups || []).map(id => `• ${id}`).join('\n') || '-';
          const out = `📋 *Daftar Akses Panel*\n\n👤 *Akses Reseller (ID per user, 1GB–Unli)*:\n${aksesList}\n\n👥 *Grup Reseller (semua member boleh create panel)*:\n${groupList}\n\n👑 *Owner Panel (bisa buat admin panel /cadmin)*:\n${ownerList}`;
          await mtSendMessage(client, chatIdLocal, out, { parseMode: 'markdown' });
          return;
        }

        // fallback: ignore other messages
      } catch (err) {
        console.error('Event handler error:', err);
        try { if (event && event.client) await sendErrorLog(event.client, err); } catch (e) {}
      }
    }, new NewMessage({}));

    // keep process alive and handle signals
    process.on('SIGINT', () => { console.log('Exit: save'); saveTranslationMode(); process.exit(); });
    process.on('SIGTERM', () => { console.log('Exit: save'); saveTranslationMode(); process.exit(); });

    console.log('MTProto client ready. Listening for messages...');
  } catch (err) {
    console.error('Fatal Error (userbot):', err);
  }
})();