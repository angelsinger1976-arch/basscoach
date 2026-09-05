import { Suite } from './harness.mjs';
import { notesToMidiFile } from '../src/lib/transcription/midiFile.js';
import { parseMidiFile, pickBassTrack, importMidiAsNotes } from '../src/lib/transcription/midiImport.js';

function u16(bytes, o) { return (bytes[o] << 8) | bytes[o + 1]; }

// Builder mínimo de pistas SMF para forzar casos raros
function smf(tracksData, { format = 0, ppq = 480 } = {}) {
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, (format >> 8) & 0xff, format & 0xff, 0, tracksData.length, (ppq >> 8) & 0xff, ppq & 0xff];
  const out = [...head];
  for (const td of tracksData) {
    out.push(0x4d, 0x54, 0x72, 0x6b, (td.length >> 24) & 0xff, (td.length >> 16) & 0xff, (td.length >> 8) & 0xff, td.length & 0xff, ...td);
  }
  return new Uint8Array(out);
}
const vlq = (n) => {
  let v = n;
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) { out.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return out;
};
const ev = (delta, ...bytes) => [...vlq(delta), ...bytes];
const eot = (delta = 0) => ev(delta, 0xff, 0x2f, 0x00);

export function run() {
  const s = new Suite('Importador MIDI · SMF parser + pista de bajo');

  // ---------- 1. Roundtrip exportador → parser ----------
  s.section('Roundtrip notesToMidiFile → importMidiAsNotes');
  {
    const notes = [
      { midi: 28, startTime: 0.0, duration: 0.55, amplitude: 0.8 },
      { midi: 33, startTime: 0.63, duration: 0.55, amplitude: 0.7 },
      { midi: 38, startTime: 1.24, duration: 0.56, amplitude: 0.6 },
      { midi: 43, startTime: 1.85, duration: 0.6, amplitude: 0.65 },
      { midi: 31, startTime: 2.74, duration: 0.4, amplitude: 0.5 },
      { midi: 31, startTime: 3.14, duration: 0.37, amplitude: 0.5 },
    ];
    const bytes = notesToMidiFile(notes, { bpm: 120 });
    const res = importMidiAsNotes(bytes);
    s.eq(res.engine, 'midi', 'Engine = midi');
    s.eq(res.notes.length, 6, 'Mismas 6 notas');
    s.eq(res.notes.map((n) => n.midi), notes.map((n) => n.midi), 'Midis idénticos');
    notes.forEach((n, i) => {
      s.approx(res.notes[i].startTime, n.startTime, 0.02, `startTime ${i}`);
      s.approx(res.notes[i].duration, n.duration, 0.03, `duration ${i}`);
    });
    s.eq(res.tempoBpm, 120, 'Tempo leído del meta (120)');
    s.assert(res.notes.every((n) => n.midi >= 21 && n.midi <= 60), 'Todo en rango de bajo');
  }

  // ---------- 2. Formato 1 multitrack con tempo en pista 0 ----------
  s.section('Formato 1 · tempo en pista 0, bajo en pista 2');
  {
    // Pista 0: solo tempo (120 bpm = 500000 µs/negra)
    const t0 = [
      ...ev(0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20), // 500000
      ...eot(0),
    ];
    // Pista 1: melodía aguda (flauta, programa 74) — no debe elegirse
    const t1 = [
      ...ev(0, 0xff, 0x03, 4, 77, 101, 108, 111), // "Melo"
      ...ev(0, 0xc1, 74),
      ...ev(0, 0x91, 79, 100), ...ev(240, 0x81, 79, 0), // Sol5 0.5s
      ...eot(0),
    ];
    // Pista 2: bajo (programa 33 = Electric Bass finger)
    const t2 = [
      ...ev(0, 0xff, 0x03, 4, 66, 97, 115, 115), // "Bass"
      ...ev(0, 0xc2, 33),
      ...ev(0, 0x92, 40, 100), ...ev(480, 0x82, 40, 0), // E2: 480 ticks = 1 negra = 0.5 s
      ...ev(0, 0x92, 43, 100), ...ev(480, 0x82, 43, 0), // G2 @0.5 s
      ...eot(0),
    ];
    const bytes = smf([t0, t1, t2], { format: 1 });
    const res = importMidiAsNotes(bytes);
    s.eq(res.nTracks, 3, '3 pistas parseadas');
    s.eq(res.notes.length, 2, 'Solo las notas de la pista de bajo');
    s.eq(res.notes.map((n) => n.midi), [40, 43], 'E2 y G2 elegidas');
    s.approx(res.notes[0].startTime, 0.0, 0.01, 'Inicio primera nota');
    s.approx(res.notes[0].duration, 0.5, 0.01, 'Duración primera nota');
    s.approx(res.notes[1].startTime, 0.5, 0.01, 'Inicio segunda nota');
    s.assert(/programa GM de bajo/.test(res.picked), 'Elegida por programa GM de bajo');
    s.eq(res.trackName, 'Bass', 'Nombre de pista leído');
  }

  // ---------- 3. Cambios de tempo ----------
  s.section('Tempo map · acelerando 120→180→90 bpm');
  {
    // 2 compases de metrónomo con cambio de tempo entre notas
    const t = [
      ...ev(0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20), // 120 bpm @tick0
      ...ev(0, 0x90, 60, 100), ...ev(480, 0x80, 60, 0),
      ...ev(0, 0x90, 60, 100), ...ev(480, 0x80, 60, 0), // 2ª negra @0.5s
      ...ev(0, 0xff, 0x51, 0x03, 0x05, 0x16, 0x15), // 180 bpm (333333µs) @tick960
      ...ev(0, 0x90, 62, 100), ...ev(480, 0x80, 62, 0), // 3ª negra: 333333µs = 0.333s
      ...ev(0, 0xff, 0x51, 0x03, 0x0a, 0x2c, 0x2a), // 90 bpm (666667µs) @tick1440
      ...ev(0, 0x90, 64, 100), ...ev(480, 0x80, 64, 0), // 4ª negra: 666667µs = 0.667s
      ...eot(0),
    ];
    const parsed = parseMidiFile(smf([t]));
    const ns = parsed.tracks[0].notes;
    s.eq(ns.length, 4, '4 notas de metrónomo');
    s.approx(ns[0].startTime, 0.0, 0.001, 'Nota 1 @0s');
    s.approx(ns[1].startTime, 0.5, 0.001, 'Nota 2 @0.5s (120bpm)');
    s.approx(ns[2].startTime, 1.0, 0.001, 'Nota 3 @1.0s (sigue 120 hasta el cambio)');
    s.approx(ns[2].duration, 0.333, 0.002, 'Nota 3 dura 0.333s (180bpm)');
    s.approx(ns[3].startTime, 1.333, 0.002, 'Nota 4 @1.333s');
    s.approx(ns[3].duration, 0.667, 0.002, 'Nota 4 dura 0.667s (90bpm)');
  }

  // ---------- 4. Running status + note-on vel 0 ----------
  s.section('Running status + note-on con velocidad 0');
  {
    const t = [
      ...ev(0, 0x90, 45, 90),          // status fijo
      ...ev(480, 45, 0),               // running status + vel0 = off
      ...ev(0, 43, 90),                // running status on
      ...ev(480, 43, 0),               // off
      ...eot(0),
    ];
    const parsed = parseMidiFile(smf([t]));
    const ns = parsed.tracks[0].notes;
    s.eq(ns.length, 2, '2 notas con running status');
    s.eq(ns.map((n) => n.midi), [45, 43], 'Midis correctos');
    s.approx(ns[0].duration, 0.5, 0.01, 'Duración correcta con vel0-as-off');
  }

  // ---------- 5. SMPTE ----------
  s.section('SMPTE (25 fps, 40 tpf = 1000 ticks/s)');
  {
    const t = [
      ...ev(0, 0x90, 40, 100), ...ev(500, 0x80, 40, 0), // 0.5 s
      ...ev(500, 0x90, 42, 100), ...ev(500, 0x80, 42, 0), // 1.0 s
      ...eot(0),
    ];
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 0x28]; // -25fps → 0xe7, 40 tpf
    const out = [...head, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, t.length, ...t];
    const parsed = parseMidiFile(new Uint8Array(out));
    const ns = parsed.tracks[0].notes;
    s.eq(ns.length, 2, '2 notas SMPTE');
    s.approx(ns[0].duration, 0.5, 0.001, '500 ticks @1000/s = 0.5s');
    s.approx(ns[1].startTime, 1.0, 0.001, '1000 ticks @1000/s = 1.0s');
    s.assert(parsed.smpte && parsed.smpte.fps === 25, 'SMPTE 25 fps detectado');
  }

  // ---------- 6. Shift de octavas ----------
  s.section('Shift de octavas al rango del bajo');
  {
    // Notas agudas (Sol4=67, Do5=72) y graves (Sol0=7 < E1)
    const t = [
      ...ev(0, 0x90, 67, 100), ...ev(240, 0x80, 67, 0),
      ...ev(0, 0x90, 72, 100), ...ev(240, 0x80, 72, 0),
      ...ev(0, 0x90, 7, 100), ...ev(240, 0x80, 7, 0),
      ...eot(0),
    ];
    const res = importMidiAsNotes(smf([t]));
    s.eq(res.notes.map((n) => n.midi), [55, 60, 31], '67→55 (Sol3), 72→60 (Do4, ya en rango), 7→31 (Sol1)');
    s.assert(res.notes.every((n) => n.midi >= 21 && n.midi <= 60), 'Rango final A0-C4');
    const sinShift = importMidiAsNotes(smf([t]), { shiftOctaves: false });
    s.eq(sinShift.notes.map((n) => n.midi), [67, 72, 7], 'shiftOctaves:false no toca las notas');
    // Con afinación std5 (B0=23 .. G2+15=58): 72 baja DOS octavas (60>58 → 48)
    const std5 = importMidiAsNotes(smf([t]), { tuningKey: 'std5' });
    s.eq(std5.notes.map((n) => n.midi), [55, 48, 31], 'std5: 67→55, 72→48 (60>58 baja otra octava), 7→31');
    s.assert(std5.notes.every((n) => n.midi >= 23 && n.midi <= 58), 'std5: rango jugable 23-58');
    // Drop D (D1=26 .. G2+15=58)
    const dropD = importMidiAsNotes(smf([t]), { tuningKey: 'dropD' });
    s.eq(dropD.notes.map((n) => n.midi), [55, 48, 31], 'dropD: mismas notas que std5 (mismo rango 26-58)');
    s.assert(dropD.notes.every((n) => n.midi >= 26 && n.midi <= 58), 'drop D: rango 26-58 respetado');
  }

  // ---------- 7. Percusión descartada + heurística sin programa ----------
  s.section('Percusión GM (canal 10) descartada; heurística por tesitura');
  {
    // Pista batería con muchas notas en canal 9
    const drums = [
      ...ev(0, 0x89, 36, 100), ...ev(240, 0x89, 38, 100), ...ev(240, 0x89, 42, 100), ...ev(240, 0x89, 36, 100),
      ...eot(0),
    ];
    // Pista "línea grave" sin programa ni nombre, notas en E1-G2
    const lowline = [
      ...ev(0, 0x90, 28, 100), ...ev(480, 0x80, 28, 0),
      ...ev(0, 0x90, 31, 100), ...ev(480, 0x80, 31, 0),
      ...eot(0),
    ];
    const res = importMidiAsNotes(smf([drums, lowline], { format: 1 }));
    s.eq(res.notes.map((n) => n.midi), [28, 31], 'Elegida la línea grave, no la batería');
    s.eq(res.picked, 'registro/tesitura', 'Razón: tesitura');
  }

  // ---------- 8. Re-trigger sin off + fusión de duplicados ----------
  s.section('Re-trigger sin note-off y fusión <30 ms');
  {
    // Re-trigger a 240 ticks (250 ms): son DOS notas E2 legítimas + una G2
    const t = [
      ...ev(0, 0x90, 40, 100),
      ...ev(240, 0x90, 40, 100),  // re-trigger: cierra la 1ª en tick 240
      ...ev(240, 0x80, 40, 0),    // off de la 2ª en tick 480
      ...ev(0, 0x90, 43, 100), ...ev(480, 0x80, 43, 0),
      ...eot(0),
    ];
    const res = importMidiAsNotes(smf([t]));
    s.eq(res.notes.length, 3, 'Re-trigger → 2 notas E2 + 1 G2');
    s.approx(res.notes[0].duration, 0.25, 0.01, 'La primera dura hasta el re-trigger');

    // Duplicado a 28 ticks (29 ms < 30 ms): se fusiona en UNA nota
    const d = [
      ...ev(0, 0x90, 40, 100),
      ...ev(28, 0x90, 40, 100),
      ...ev(452, 0x80, 40, 0), // off en tick 480
      ...eot(0),
    ];
    const res2 = importMidiAsNotes(smf([d]));
    s.eq(res2.notes.length, 1, 'Doble ataque a 29 ms se fusiona en 1 nota');
    s.approx(res2.notes[0].duration, 0.5, 0.01, 'La nota fusionada cubre 0→480 ticks (0.5 s)');
  }

  // ---------- 9. Errores controlados ----------
  s.section('Errores controlados');
  {
    let threw = null;
    try { importMidiAsNotes(new Uint8Array(8)); } catch (e) { threw = e; }
    s.assert(threw && /vacío o truncado/.test(threw.message), 'Archivo truncado → error claro');
    threw = null;
    try { importMidiAsNotes(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])); } catch (e) { threw = e; }
    s.assert(threw && /No es un archivo MIDI/.test(threw.message), 'No-MIDI (RIFF) → error claro');
    // Pista solo con meta-eventos (sin notas)
    const metaOnly = [...ev(0, 0xff, 0x03, 1, 88), ...eot(0)];
    threw = null;
    try { importMidiAsNotes(smf([metaOnly])); } catch (e) { threw = e; }
    s.assert(threw && /no contiene notas/.test(threw.message), 'Solo meta → error claro');
  }

  return s;
}
