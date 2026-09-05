// ============================================================
// BassCoach · Importador MIDI estándar (SMF)
// Lee un archivo .mid y extrae la línea de bajo para practicar:
//   [nota, octava, tiempo inicio, duración] — mismo formato que
//   la transcripción de audio, así que fluye directo al QUIZ.
// Parser propio (sin dependencias): formato 0/1/2, tempo map con
// cambios de tempo, running status, SMPTE, multitrack con
// heurística para elegir la pista de bajo.
// ============================================================

const MThd = 0x4d546864; // 'MThd'
const MTrk = 0x4d54726b; // 'MTrk'

const BASS_PROGRAMS = new Set([32, 33, 34, 35, 36, 37, 38, 39]); // GM: contrabajo + bajos eléctricos/synth
const DRUM_CHANNEL = 9; // canal 10 (0-index) = percusión GM

import { tuningMidis } from '../theory.js';

class MidiParseError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'MidiParseError';
  }
}

// ---------- helpers de lectura ----------

function u32be(v, o) {
  return (v[o] << 24) | (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3];
}
function u16be(v, o) {
  return (v[o] << 8) | v[o + 1];
}
function ascii(v, o, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(v[o + i]);
  return s;
}

/** Lee un valor de longitud variable MIDI desde data[o]; devuelve {value, next} */
function readVarLen(data, o) {
  let value = 0;
  for (let i = 0; i < 5 && o < data.length; i++) {
    const b = data[o++];
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) return { value, next: o };
  }
  return { value, next: o };
}

// ---------- parser principal ----------

/**
 * Parsea un SMF completo.
 * @param {Uint8Array} bytes
 * @returns {{format:number, ppq:number|null, smpte:{fps:number,ticksPerFrame:number}|null,
 *   tracks:Array<{name:string, channels:Set<number>, programs:number[], noteCount:number,
 *   avgMidi:number, notes:Array<{midi:number,startTime:number,duration:number,velocity:number,channel:number}>}>,
 *   tempoEvents:Array<{tick:number,usPerQuarter:number}>, duration:number}}
 */
export function parseMidiFile(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 14) {
    throw new MidiParseError('El archivo MIDI está vacío o truncado.');
  }
  if (u32be(bytes, 0) !== MThd) {
    throw new MidiParseError('No es un archivo MIDI estándar (falta la cabecera MThd).');
  }
  const headerLen = u32be(bytes, 4);
  const format = u16be(bytes, 8);
  const ntracks = u16be(bytes, 10);
  const division = u16be(bytes, 12);

  let ppq = null;
  let smpte = null;
  if (division & 0x8000) {
    // SMPTE: byte alto = -fps (complemento a 2), byte bajo = ticks por frame
    const fps = 256 - (division >> 8); // 24|25|29.97|30
    smpte = { fps, ticksPerFrame: division & 0xff };
  } else {
    ppq = division || 480;
  }

  const tempoEvents = []; // {tick, usPerQuarter}
  const tracks = [];

  let o = 8 + headerLen;
  let parsedTracks = 0;
  while (parsedTracks < ntracks && o + 8 <= bytes.length) {
    const id = u32be(bytes, o);
    const len = u32be(bytes, o + 4);
    if (id !== MTrk) {
      // Chunk desconocido (p. ej. de algunos secuenciadores): saltarlo
      o += 8 + len;
      continue;
    }
    const trackData = bytes.subarray(o + 8, Math.min(o + 8 + len, bytes.length));
    const t = parseTrack(trackData, ppq, smpte, tempoEvents);
    tracks.push(t);
    parsedTracks++;
    o += 8 + len;
  }

  if (!tracks.length) throw new MidiParseError('El MIDI no contiene pistas de datos.');

  // Tempo map global (los formatos 1 suelen traerlo en la pista 0) + fallback 120 bpm
  tempoEvents.sort((a, b) => a.tick - b.tick);
  if (!tempoEvents.length || tempoEvents[0].tick > 0) {
    tempoEvents.unshift({ tick: 0, usPerQuarter: 500000 }); // 120 bpm
  }

  // Función tick→segundos (piecewise, soporta cambios de tempo)
  const tickToSec = makeTickToSec(tempoEvents, ppq, smpte);
  for (const t of tracks) {
    for (const n of t.rawNotes) {
      const startTime = tickToSec(n.onTick);
      const endTime = tickToSec(n.offTick);
      t.notes.push({
        midi: n.midi,
        startTime,
        duration: Math.max(0.03, endTime - startTime),
        velocity: n.velocity,
        channel: n.channel,
      });
    }
    t.notes.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
    if (t.notes.length) {
      t.avgMidi = t.notes.reduce((a, n) => a + n.midi, 0) / t.notes.length;
    }
    delete t.rawNotes;
  }

  const duration = Math.max(
    0,
    ...tracks.map((t) => (t.notes.length ? t.notes[t.notes.length - 1].startTime + t.notes[t.notes.length - 1].duration : 0))
  );
  return { format, ppq, smpte, tracks, tempoEvents, duration };
}

function parseTrack(data, ppq, smpte, tempoEvents) {
  let tick = 0;
  let i = 0;
  let status = 0;
  let name = '';
  const programs = [];
  const channels = new Set();
  const open = new Map(); // clave `${ch}:${midi}` → {onTick, velocity}
  const rawNotes = []; // {onTick, offTick, midi, velocity, channel}
  const trackEnd = { tick: 0 };

  const closeNote = (ch, midi, offTick) => {
    const key = ch + ':' + midi;
    const on = open.get(key);
    if (!on) return;
    open.delete(key);
    rawNotes.push({ onTick: on.onTick, offTick, midi, velocity: on.velocity, channel: ch });
  };

  while (i < data.length) {
    const dt = readVarLen(data, i);
    i = dt.next;
    tick += dt.value;
    trackEnd.tick = Math.max(trackEnd.tick, tick);

    let b = data[i];
    if (b === 0xff) {
      // Meta evento
      i++;
      const type = data[i++];
      const len = readVarLen(data, i);
      i = len.next;
      const payload = data.subarray(i, i + len.value);
      i += len.value;
      if (type === 0x51 && len.value === 3) {
        const usPerQuarter = (payload[0] << 16) | (payload[1] << 8) | payload[2];
        tempoEvents.push({ tick, usPerQuarter });
      } else if (type === 0x03) {
        name = ascii(payload, 0, payload.length).trim();
      } else if (type === 0x2f) {
        break; // end of track
      }
    } else if (b === 0xf0 || b === 0xf7) {
      // Sysex: saltar
      i++;
      const len = readVarLen(data, i);
      i = len.next + len.value;
    } else {
      // Evento de canal (con running status)
      if (b & 0x80) {
        status = b;
        i++;
      } else if (!status) {
        // Byte de dato sin status previo: archivo corrupto
        throw new MidiParseError('Archivo MIDI corrupto (running status sin evento previo).');
      }
      const type = status & 0xf0;
      const ch = status & 0x0f;
      channels.add(ch);
      if (type === 0x90) {
        const midi = data[i++];
        const vel = data[i++];
        if (vel === 0) {
          closeNote(ch, midi, tick); // note-on con velocidad 0 = note-off
        } else {
          const key = ch + ':' + midi;
          if (open.has(key)) closeNote(ch, midi, tick); // re-trigger sin off
          open.set(key, { onTick: tick, velocity: vel });
        }
      } else if (type === 0x80) {
        const midi = data[i++];
        i++; // velocity del off (ignorada)
        closeNote(ch, midi, tick);
      } else if (type === 0xc0) {
        const prog = data[i++] & 0x7f;
        programs.push(prog);
      } else if (type === 0xd0) {
        i++; // channel pressure: 1 byte
      } else {
        i += 2; // pitch bend, control change, poly pressure: 2 bytes
      }
    }
  }
  // Notas sin note-off (archivo truncado): cerrarlas al final de la pista
  for (const [key, on] of open) {
    const [chStr, midiStr] = key.split(':');
    rawNotes.push({
      onTick: on.onTick,
      offTick: Math.max(on.onTick + 1, trackEnd.tick),
      midi: +midiStr,
      velocity: on.velocity,
      channel: +chStr,
    });
  }
  rawNotes.sort((a, b) => a.onTick - b.onTick || a.midi - b.midi);
  return { name, channels, programs, noteCount: rawNotes.length, rawNotes, notes: [], avgMidi: null };
}

function makeTickToSec(tempoEvents, ppq, smpte) {
  if (smpte) {
    // SMPTE: tiempo absoluto, independiente de tempos
    const secPerTick = 1 / (smpte.fps * smpte.ticksPerFrame);
    return (tick) => tick * secPerTick;
  }
  // PPQ: piecewise según el tempo vigente en cada tick
  const points = []; // {tick, sec, usPerQ}
  let sec = 0;
  let cur = tempoEvents[0];
  points.push({ tick: 0, sec: 0, usPerQ: cur.usPerQuarter });
  for (let k = 1; k < tempoEvents.length; k++) {
    const ev = tempoEvents[k];
    const dtTicks = ev.tick - cur.tick;
    sec += (dtTicks * cur.usPerQuarter) / (ppq * 1e6);
    points.push({ tick: ev.tick, sec, usPerQ: ev.usPerQuarter });
    cur = ev;
  }
  return (tick) => {
    let p = points[0];
    for (let k = 1; k < points.length; k++) {
      if (points[k].tick <= tick) p = points[k];
      else break;
    }
    return p.sec + ((tick - p.tick) * p.usPerQ) / (ppq * 1e6);
  };
}

// ---------- selección de la pista de bajo ----------

/**
 * Heurística: puntúa cada pista y devuelve la más "bajista".
 * Prioridad: programa GM de bajo (32-39) > nombre de pista > registro
 * medio/tesitura de bajo > cantidad de notas. Descarta percusión.
 */
export function pickBassTrack(tracks) {
  let best = null;
  let bestScore = -Infinity;
  for (const t of tracks) {
    if (!t.noteCount) continue;
    let score = 0;
    // Percusión GM (canal 10): casi siempre descartar
    if (t.channels.size === 1 && t.channels.has(DRUM_CHANNEL)) score -= 1000;
    if (t.programs.some((p) => BASS_PROGRAMS.has(p))) score += 120;
    if (/bass|bajo|baixo/i.test(t.name)) score += 90;
    const inRange = t.notes.filter((n) => n.midi >= 21 && n.midi <= 55).length;
    score += (inRange / t.noteCount) * 60; // tesitura de bajo
    if (t.avgMidi >= 26 && t.avgMidi <= 50) score += 30;
    if (t.channels.has(DRUM_CHANNEL)) score -= 20;
    score += Math.min(20, t.noteCount / 20); // prefiere pistas con contenido
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** Lleva una nota al rango del bajo (E1=21 .. C4=60) por octavas. */
function intoBassRange(midi, { min = 21, max = 60 } = {}) {
  let m = midi;
  let guard = 0;
  while (m > max && guard++ < 10) m -= 12;
  while (m < min && guard++ < 20) m += 12;
  return m;
}

/**
 * Rango jugable para una afinación dada: cuerda más grave .. cuerda más aguda +15 trastes.
 * p. ej. std4 → 28..58; std5 → 23..58; drop D → 26..58.
 */
function playableRange(tuningKey) {
  const strings = tuningMidis(tuningKey);
  const lowest = Math.min(...strings);
  const highest = Math.min(60, Math.max(...strings) + 15);
  return { min: lowest, max: highest };
}

/**
 * Importa un .mid y devuelve la línea de bajo lista para practicar
 * (mismo contrato que transcribeAudioFile: { engine, notes, duration }).
 * @param {Uint8Array} bytes
 * @param {object} opts { shiftOctaves=true, min=21, max=60 }
 * @returns {{engine:'midi', notes:Array<{midi,startTime,duration,velocity}>, duration:number,
 *   trackName:string, tempoBpm:number, nTracks:number, picked:string}}
 */
export function importMidiAsNotes(bytes, opts = {}) {
  const { shiftOctaves = true, min = 21, max = 60, tuningKey = null } = opts;
  const range = tuningKey ? playableRange(tuningKey) : { min, max };
  const parsed = parseMidiFile(bytes);
  const track = pickBassTrack(parsed.tracks);
  if (!track || !track.notes.length) {
    throw new MidiParseError('El MIDI no contiene notas (solo meta-eventos o percusión).');
  }

  let notes = track.notes.map((n) => ({
    ...n,
    midi: shiftOctaves ? intoBassRange(n.midi, range) : n.midi,
  }));

  // Fusiona re-triggers/duplicados de misma nota a <30 ms: conserva el más largo
  const merged = [];
  for (const n of notes) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.midi === n.midi &&
      Math.abs(prev.startTime - n.startTime) < 0.03
    ) {
      if (n.startTime + n.duration > prev.startTime + prev.duration) {
        prev.duration = n.startTime + n.duration - prev.startTime;
      }
    } else {
      merged.push({ ...n });
    }
  }
  notes = merged.sort((a, b) => a.startTime - b.startTime);

  const usPerQuarter = parsed.tempoEvents[0]?.usPerQuarter ?? 500000;
  const tempoBpm = Math.round(60000000 / usPerQuarter);
  const why = [];
  if (track.programs.some((p) => BASS_PROGRAMS.has(p))) why.push('programa GM de bajo');
  if (/bass|bajo|baixo/i.test(track.name)) why.push('nombre de pista');
  return {
    engine: 'midi',
    notes,
    duration: Math.max(parsed.duration, notes.length ? notes[notes.length - 1].startTime + notes[notes.length - 1].duration : 0),
    trackName: track.name || 'Pista importada',
    tempoBpm,
    nTracks: parsed.tracks.length,
    picked: why.join(' + ') || 'registro/tesitura',
  };
}
