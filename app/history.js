// history.js
import { supa, ensureAuthedOrRedirect } from './supabase.js';

const $ = (s, r = document) => r.querySelector(s);
const list = $('#list');

const params = new URLSearchParams(location.search);
const returnTo = params.get('returnTo') || 'home.html';

function initialFromEmail(email = '') {
  const c = (email || '?').trim()[0] || '?';
  return c.toUpperCase();
}

function convUrl(id) {
  const q = new URLSearchParams({ c: id }).toString();
  return `./home.html?${q}`;
}

async function getConvosFromSupabase(userId) {
  try {
    const { data, error } = await supa
      .from('conversations')
      .select('id,title,updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data.map(r => ({
      id: r.id,
      title: r.title || 'Untitled',
      updated_at: r.updated_at || new Date().toISOString()
    }));
  } catch (e) {
    // table missing etc. fall back to localStorage
    return null;
  }
}

function getConvosFromLocal() {
  const raw = localStorage.getItem('convos') || '[]';
  try { return JSON.parse(raw); } catch { return []; }
}

function saveConvosToLocal(convos) {
  localStorage.setItem('convos', JSON.stringify(convos));
}

function renderConvos(convos) {
  list.innerHTML = '';
  if (!convos || convos.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'conv-item';
    empty.textContent = 'No conversations yet. Tap “New Conversation” to start.';
    list.appendChild(empty);
    return;
  }
  for (const c of convos) {
    const el = document.createElement('div');
    el.className = 'conv-item';
    el.innerHTML = `
      <div class="title">${c.title || 'Untitled'}</div>
      <div class="date">${new Date(c.updated_at || Date.now()).toLocaleDateString(undefined,{month:'long',day:'numeric'})}</div>
    `;
    el.addEventListener('click', () => (window.location.href = convUrl(c.id)));
    list.appendChild(el);
  }
}

async function createConversation(userId, email) {
  const title = 'New Conversation';
  // Try Supabase first
  try {
    const { data, error } = await supa
      .from('conversations')
      .insert([{ user_id: userId, title }])
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  } catch {
    // Fallback to localStorage
    const convos = getConvosFromLocal();
    const id = crypto.randomUUID();
    convos.unshift({ id, title, updated_at: new Date().toISOString() });
    saveConvosToLocal(convos);
    return id;
  }
}

$('#btn-close').addEventListener('click', () => {
  // return to where we came from (defaults to home.html)
  const dest = decodeURIComponent(returnTo);
  window.location.href = dest.match(/\.html/) ? dest : 'home.html';
});

$('#btn-settings').addEventListener('click', () => {
  alert('Settings coming soon.');
});

$('#btn-new').addEventListener('click', async () => {
  const { data: { user } } = await supa.auth.getUser();
  const id = await createConversation(user?.id, user?.email);
  window.location.href = convUrl(id);
});

(async function boot() {
  await ensureAuthedOrRedirect();
  const { data: { user } } = await supa.auth.getUser();

  // Render bottom user row
  $('#user-name').textContent = user?.user_metadata?.full_name || user?.email || 'You';
  $('#avatar').textContent = initialFromEmail(user?.email);

  // Load conversations
  let convos = await getConvosFromSupabase(user?.id);
  if (!convos) convos = getConvosFromLocal();
  renderConvos(convos);
})();
