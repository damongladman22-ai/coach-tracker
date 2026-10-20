// Saved Ask PitchSide conversations, kept in this browser (Damon 2026-10-14:
// "in this browser"; history moves to the account once family accounts exist).
// Pure: every function takes the storage object (localStorage in the page, an
// in-memory stand-in in the tests) and never throws.
//
// Stored under one key as { chats: [{ id, title, program, gender, updatedAt, msgs }] },
// newest first, at most MAX_CHATS chats of at most MAX_MSGS messages each.
// The single chat kept before 14 Oct (ask-pitchside-thread-v1, with its
// program in ask-pitchside-program-v1) becomes the first saved chat.

export const KEY = 'ask-pitchside-chats-v1'
export const MAX_CHATS = 30
export const MAX_MSGS = 30
const OLD_THREAD = 'ask-pitchside-thread-v1'
const OLD_PROGRAM = 'ask-pitchside-program-v1'

export const newChatId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const read = (storage, key, fallback) => {
  try { const v = JSON.parse(storage.getItem(key) || 'null'); return v ?? fallback } catch { return fallback }
}

export function titleOf(msgs) {
  const first = (msgs || []).find(m => m.role === 'user')
  const t = String(first?.content || 'New chat').replace(/\s+/g, ' ').trim()
  return t.length > 70 ? t.slice(0, 67).trimEnd() + '…' : t
}

// Only finished messages are saved; a reply still streaming is left out.
const keep = msgs => (msgs || []).filter(m => m.status !== 'streaming').slice(-MAX_MSGS)

export function loadChats(storage) {
  const v = read(storage, KEY, null)
  if (v && Array.isArray(v.chats)) return v.chats.filter(c => c && c.id && Array.isArray(c.msgs))
  const old = read(storage, OLD_THREAD, [])
  if (!Array.isArray(old) || !old.length) return []
  const program = read(storage, OLD_PROGRAM, null)
  const chats = [{ id: newChatId(), title: titleOf(old), program: program?.id ? program : null, updatedAt: Date.now(), msgs: keep(old) }]
  saveChats(storage, chats)
  try { storage.removeItem(OLD_THREAD); storage.removeItem(OLD_PROGRAM) } catch { /* blocked */ }
  return chats
}

export function saveChats(storage, chats) {
  let list = (chats || []).slice(0, MAX_CHATS)
  // If the browser's storage is full, drop the oldest chats until it fits.
  while (list.length) {
    try { storage.setItem(KEY, JSON.stringify({ chats: list })); return list } catch { list = list.slice(0, -1) }
  }
  try { storage.removeItem(KEY) } catch { /* blocked */ }
  return []
}

/** The chat list with this chat saved and moved to the top. An empty chat is not saved. */
export function putChat(chats, { id, program, gender = null, msgs }) {
  const rest = (chats || []).filter(c => c.id !== id)
  const m = keep(msgs)
  if (!m.length) return rest
  return [{ id, title: titleOf(m), program: program || null, gender: gender === 'M' || gender === 'W' ? gender : null, updatedAt: Date.now(), msgs: m }, ...rest].slice(0, MAX_CHATS)
}

export const dropChat = (chats, id) => (chats || []).filter(c => c.id !== id)

/** "Today", "Yesterday", "Oct 9" or "Oct 9, 2025". */
export function whenLabel(ts, now = Date.now()) {
  const d = new Date(ts), n = new Date(now)
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(n) - day(d)) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  const opts = { month: 'short', day: 'numeric', ...(d.getFullYear() !== n.getFullYear() ? { year: 'numeric' } : {}) }
  return d.toLocaleDateString('en-US', opts)
}
