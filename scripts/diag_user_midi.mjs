// Diagnóstico: parsea el MIDI real del usuario (PRESIDENTE_-bass.mid)
import { readFileSync } from 'node:fs';
import { parseMidiFile, pickBassTrack, importMidiAsNotes } from '../src/lib/transcription/midiImport.js';

const bytes = new Uint8Array(readFileSync(new URL('../PRESIDENTE_-bass.mid', import.meta.url)));
console.log('Archivo:', bytes.length, 'bytes');

const parsed = parseMidiFile(bytes);
console.log('Formato:', parsed.format, '· PPQ:', parsed.ppq, '· pistas:', parsed.tracks.length);
console.log('Tempo events:', parsed.tempoEvents.map((t) => `${t.usPerQuarter}us@${t.tick}`).join(', '));
const bpm = Math.round(60000000 / (parsed.tempoEvents[0]?.usPerQuarter ?? 500000));
console.log('Tempo inicial:', bpm, 'bpm');

for (const [i, t] of parsed.tracks.entries()) {
  console.log(`\nPista ${i}: "${t.name}" · notas: ${t.noteCount} · canales: ${[...t.channels]} · programas: ${t.programs}`);
  if (t.notes.length) {
    console.log(`  avg MIDI: ${t.avgMidi.toFixed(1)} · rango: ${Math.min(...t.notes.map(n=>n.midi))}-${Math.max(...t.notes.map(n=>n.midi))}`);
    console.log('  primeras 8:', t.notes.slice(0, 8).map((n) => `M${n.midi}@${n.startTime.toFixed(2)}s/${n.duration.toFixed(2)}s`).join(' '));
  }
}

const track = pickBassTrack(parsed.tracks);
console.log('\n→ Pista elegida:', track ? `"${track.name}" (${track.noteCount} notas)` : 'NINGUNA');

const res = importMidiAsNotes(bytes);
console.log('\n=== RESULTADO importMidiAsNotes ===');
console.log('Razón:', res.picked, '· tempo:', res.tempoBpm, 'bpm · duración:', res.duration.toFixed(1), 's');
console.log('Notas totales:', res.notes.length);
console.log('Rango MIDI:', Math.min(...res.notes.map(n=>n.midi)), '-', Math.max(...res.notes.map(n=>n.midi)));
const hist = {};
for (const n of res.notes) hist[n.midi] = (hist[n.midi] || 0) + 1;
console.log('Histograma:', Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([m,c])=>`M${m}×${c}`).join(' '));
console.log('\nPrimeras 20 notas:');
res.notes.slice(0, 20).forEach((n, i) =>
  console.log(`  ${String(i+1).padStart(2)}. M${n.midi} @${n.startTime.toFixed(2)}s dur=${n.duration.toFixed(2)}s vel=${n.velocity}`)
);
console.log('...\nÚltimas 5:');
res.notes.slice(-5).forEach((n, i) =>
  console.log(`  M${n.midi} @${n.startTime.toFixed(2)}s dur=${n.duration.toFixed(2)}s`)
);
