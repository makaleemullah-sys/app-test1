// Persistence for the single-file phone build.
// - Inside claude.ai: each viewer's private `data/users/<id>/…` documents
//   (synced across their devices, invisible to anyone else).
// - Everywhere: a localStorage copy, so the app also works offline or as a
//   plain file. Every storage call is guarded; the app still runs in memory.

const LOCAL_KEY = 'lunaria-phone-v1';
const EMPTY = () => ({ version: 1, seq: 1, session: null, users: [] });

let state = EMPTY();
let remote = null; // { col, written: Map<docId, json> }
let saveTimer = null;
let saving = Promise.resolve();
export let storageMode = 'memory';

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); if (storageMode === 'memory') storageMode = 'device'; } catch { /* storage blocked */ }
}

/** Split state into documents well under the 256 KiB per-document cap. */
function chunks() {
  const out = new Map();
  out.set('core', {
    version: state.version, seq: state.seq, session: state.session,
    users: state.users.map(({ logs, foods, ...u }) => u),
  });
  for (const u of state.users) {
    const years = new Set([...Object.keys(u.logs || {}), ...(u.foods || []).map((f) => f.date)].map((d) => d.slice(0, 4)));
    for (const y of years) {
      out.set(`y${y}-u${u.id}`, {
        logs: Object.fromEntries(Object.entries(u.logs || {}).filter(([d]) => d.startsWith(y))),
        foods: (u.foods || []).filter((f) => f.date.startsWith(y)),
      });
    }
  }
  return out;
}

function assemble(docs) {
  const core = docs.get('core');
  if (!core) return null;
  const s = { ...EMPTY(), ...core, users: core.users.map((u) => ({ ...u, logs: {}, foods: [] })) };
  for (const [id, body] of docs) {
    const m = /^y\d{4}-u(\d+)$/.exec(id);
    const u = m && s.users.find((x) => String(x.id) === m[1]);
    if (!u) continue;
    Object.assign(u.logs, body.logs || {});
    u.foods.push(...(body.foods || []));
  }
  return s;
}

async function connectRemote() {
  if (!globalThis.claude?.use) return null;
  try {
    const [db, user] = await Promise.all([globalThis.claude.use('db'), globalThis.claude.use('user')]);
    const uid = db && user ? await user.id() : null;
    if (!uid) return null;
    const col = db.collection(`data/users/${uid}`);
    const snap = await col.get();
    const docs = new Map(snap.docs.filter((d) => d.exists).map((d) => [d.id, d.data()]));
    return { col, docs };
  } catch { return null; }
}

export async function initStore() {
  state = readLocal() || EMPTY();
  if (readLocal()) storageMode = 'device';
  const r = await connectRemote();
  if (r) {
    const fromRemote = assemble(r.docs);
    remote = { col: r.col, written: new Map([...r.docs].map(([k, v]) => [k, JSON.stringify(v)])) };
    storageMode = 'account';
    if (fromRemote) state = fromRemote;
    else if (state.users.length) scheduleSave(); // first visit with an account: upload this device's data
    writeLocal();
  }
  return state;
}

export function getState() { return state; }

export function scheduleSave() {
  writeLocal();
  if (!remote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saving = saving.then(flushRemote); }, 700);
}

async function flushRemote() {
  if (!remote) return;
  const next = chunks();
  try {
    // One write at a time, only for documents whose content changed.
    for (const [id, body] of next) {
      const json = JSON.stringify(body);
      if (remote.written.get(id) === json) continue;
      await remote.col.doc(id).set(body);
      remote.written.set(id, json);
    }
    for (const id of [...remote.written.keys()]) {
      if (!next.has(id)) { await remote.col.doc(id).delete(); remote.written.delete(id); }
    }
  } catch (err) {
    // View-only access or a revoked grant: keep working from this device.
    if (['invalid_argument', 'revoked', 'not_granted', 'capability_disabled'].includes(err?.code)) {
      remote = null;
      storageMode = 'device';
    }
  }
}
