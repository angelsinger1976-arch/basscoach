// ============================================================
// BassCoach · Biblioteca de canciones (persistente)
// Guarda las secuencias importadas (MIDI/transcripción) en
// localStorage del dispositivo: sobrevive a recargas y al
// cierre del navegador. Sin servidor — todo local.
// ============================================================

const KEY = 'basscoach.library.v1';
const MAX_ITEMS = 60; // cuota de localStorage ~5MB; ~60 secuencias holgadas

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: 1, items: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return { version: 1, items: [] };
    return data;
  } catch {
    return { version: 1, items: [] };
  }
}

function write(store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch (err) {
    console.warn('[BassCoach] No se pudo guardar en localStorage (¿cuota llena?):', err);
    return false;
  }
}

/** Lista las secuencias guardadas (metadatos, sin las notas). Más reciente primero. */
export function listLibrary() {
  return read().items
    .map(({ id, name, engine, notes, noteCount, duration, tempo, source, savedAt }) =>
      ({ id, name, engine, noteCount: noteCount ?? (notes ? notes.length : 0), duration, tempo, source, savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Guarda una secuencia {name, engine, notes, duration?, tempo?, source?}. Devuelve el id o null. */
export function saveToLibrary(entry) {
  const store = read();
  const id = 'seq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const item = {
    id,
    name: (entry.name || 'Secuencia').slice(0, 80),
    engine: entry.engine || 'midi',
    notes: entry.notes.map((n) => ({
      midi: n.midi,
      startTime: +n.startTime.toFixed(3),
      duration: +Math.max(0.05, n.duration).toFixed(3),
      velocity: n.velocity ?? Math.round((n.amplitude ?? 0.7) * 127),
    })),
    duration: +(entry.duration ?? entry.notes.reduce((a, n) => Math.max(a, n.startTime + n.duration), 0)).toFixed(1),
    noteCount: entry.notes.length,
    tempo: entry.tempo ?? null,
    source: entry.source ?? null,
    savedAt: Date.now(),
  };
  store.items.push(item);
  // Cuota: elimina las más viejas si se pasa del máximo
  while (store.items.length > MAX_ITEMS) store.items.shift();
  return write(store) ? id : null;
}

/** Carga una secuencia por id (con las notas). null si no existe. */
export function loadFromLibrary(id) {
  const item = read().items.find((i) => i.id === id);
  return item ? { ...item } : null;
}

/** Borra por id. Devuelve true si existía. */
export function deleteFromLibrary(id) {
  const store = read();
  const before = store.items.length;
  store.items = store.items.filter((i) => i.id !== id);
  if (store.items.length === before) return false;
  write(store);
  return true;
}

/** Total de notas guardadas (para el indicador de espacio). */
export function libraryStats() {
  const items = read().items;
  return { count: items.length, notes: items.reduce((a, i) => a + i.notes.length, 0) };
}
