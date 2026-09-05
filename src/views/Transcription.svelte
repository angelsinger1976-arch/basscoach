<script>
  // ============================================================
  // BassCoach · Vista TRANSCRIPTION
  // Sube mp3/wav/ogg → Basic Pitch (IA) o fallback DSP →
  // secuencia [{midi, startTime, duration}] → práctica en QUIZ
  // o exportación MIDI/JSON. Muestra progreso y motor usado.
  // + Importa .mid (parser SMF propio, pista de bajo por
  //   heurística) + biblioteca persistente (localStorage).
  // ============================================================
  import { midiToName } from '../lib/theory.js';
  import {
    transcribeAudioFile, decodeAudioFile,
  } from '../lib/transcription/transcribe.js';
  import { importMidiAsNotes } from '../lib/transcription/midiImport.js';
  import { downloadMidi, downloadJson } from '../lib/transcription/midiFile.js';
  import {
    listLibrary, saveToLibrary, loadFromLibrary, deleteFromLibrary, libraryStats,
  } from '../lib/transcription/library.js';

  export let onSendToQuiz = null;
  export let tuning = 'std4';
  export let latin = true;

  let file = null;
  let status = 'idle'; // idle | decoding | transcribing | importing | done | error
  let progress = 0;
  let engineUsed = '';
  let notes = [];      // notas de la selección actual (compás range)
  let allNotes = [];   // notas importadas completas
  let errorMsg = '';
  let fileName = '';
  let duration = 0;
  let dragging = false;
  let inputEl;
  let previewUrl = null;
  let importInfo = ''; // línea informativa del MIDI importado

  // selector de compases
  let barStart = 1;
  let barEnd = 1;
  let barsTotal = 1;
  let tempoBpm = null;
  let secsPerBar = 0;

  // biblioteca
  let library = [];
  let stats = { count: 0, notes: 0 };

  function refreshLibrary() {
    library = listLibrary();
    stats = libraryStats();
  }
  refreshLibrary();

  function isMidiFile(f) {
    return /\.(mid|midi|smf)$/i.test(f.name) || /midi/i.test(f.type);
  }
  function isAudioFile(f) {
    return /audio|mp3|wav|ogg|flac|m4a|aiff/i.test(f.type + ' ' + f.name) && !isMidiFile(f);
  }

  function onDrop(e) {
    e.preventDefault();
    dragging = false;
    handleFiles(e.dataTransfer.files);
  }
  function onDragOver(e) { e.preventDefault(); dragging = true; }
  function onDragLeave() { dragging = false; }

  async function handleFiles(files) {
    const f = files && files[0];
    if (!f) return;
    if (isMidiFile(f)) return handleMidi(f);
    if (!isAudioFile(f)) {
      errorMsg = 'Formato no soportado. Usa audio (mp3, wav, ogg, m4a) o MIDI (.mid).';
      status = 'error';
      return;
    }
    return handleAudio(f);
  }

  async function handleAudio(f) {
    file = f;
    fileName = f.name;
    errorMsg = '';
    status = 'decoding';
    progress = 5;
    importInfo = '';
    try {
      const buf = await f.arrayBuffer();
      previewUrl = URL.createObjectURL(f);
      duration = 0;
      const audioBuffer = await decodeAudioFile(buf);
      duration = audioBuffer.duration;
      status = 'transcribing';
      progress = 12;
      const result = await transcribeAudioFile(buf, {
        decodedBuffer: audioBuffer,
        onProgress: (p) => { progress = 12 + Math.round(p * 0.83); },
        onEngine: (e) => { engineUsed = e; },
      });
      engineUsed = result.engine;
      finishLoad(result.notes, { engine: result.engine, tempo: null });
    } catch (err) {
      console.error(err);
      errorMsg = err && err.message ? err.message : 'Error al transcribir';
      status = 'error';
    }
  }

  async function handleMidi(f) {
    file = f;
    fileName = f.name;
    errorMsg = '';
    status = 'importing';
    importInfo = '';
    progress = 30;
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const result = importMidiAsNotes(buf, { tuningKey: tuning });
      progress = 100;
      engineUsed = 'midi';
      importInfo = `${result.nTracks} pistas · ${result.tempoBpm} bpm · pista elegida: ${result.picked}`;
      finishLoad(result.notes, { engine: 'midi', tempo: result.tempoBpm });
    } catch (err) {
      console.error(err);
      errorMsg = err && err.message ? err.message : 'Error al importar el MIDI';
      status = 'error';
    }
  }

  /** Carga el MIDI de demo incluido en la app (public/demo-bass.mid). */
  async function loadDemo() {
    errorMsg = '';
    status = 'importing';
    progress = 20;
    importInfo = '';
    try {
      const res = await fetch('demo-bass.mid');
      if (!res.ok) throw new Error('No se encontró demo-bass.mid');
      const buf = new Uint8Array(await res.arrayBuffer());
      progress = 80;
      const result = importMidiAsNotes(buf, { tuningKey: tuning });
      progress = 100;
      engineUsed = 'midi';
      fileName = 'demo-bass.mid';
      importInfo = `${result.nTracks} pistas · ${result.tempoBpm} bpm · pista elegida: ${result.picked}`;
      finishLoad(result.notes, { engine: 'midi', tempo: result.tempoBpm });
    } catch (err) {
      console.error(err);
      errorMsg = err && err.message ? err.message : 'Error al cargar la demo';
      status = 'error';
    }
  }

  /** Notas cargadas → estado de vista + autoguardado en biblioteca. */
  function finishLoad(loaded, meta = {}) {
    allNotes = loaded.map((n) => ({ ...n }));
    tempoBpm = meta.tempo;
    duration = allNotes.length
      ? allNotes[allNotes.length - 1].startTime + allNotes[allNotes.length - 1].duration
      : 0;
    computeBars();
    applyBarRange();
    status = 'done';
    progress = 100;

    // Autoguardado en la biblioteca (salvo que ya venga de ahí)
    if (meta.fromLibrary !== true) {
      const name = fileName.replace(/\.[^.]+$/, '') || 'Secuencia';
      const id = saveToLibrary({
        name,
        engine: meta.engine || engineUsed,
        notes: allNotes,
        duration,
        tempo: meta.tempo,
        source: fileName,
      });
      if (id) refreshLibrary();
    }
  }

  // ---------- selector de compases ----------
  $: if (tempoBpm) secsPerBar = (60 / tempoBpm) * 4; // 4/4

  function computeBars() {
    // Compases a partir del tempo (MIDI) o estimación 4/4 @120 (audio)
    const bpm = tempoBpm || 120;
    secsPerBar = (60 / bpm) * 4;
    barsTotal = Math.max(1, Math.ceil(duration / secsPerBar));
    barStart = 1;
    barEnd = Math.min(barsTotal, barStart + Math.max(0, Math.ceil(16 / 4) - 1)); // ~4 compases por defecto
    barEnd = Math.max(barEnd, 1);
  }

  function applyBarRange() {
    const t0 = (barStart - 1) * secsPerBar;
    const t1 = barEnd * secsPerBar;
    notes = allNotes.filter((n) => n.startTime >= t0 - 1e-3 && n.startTime < t1);
    if (!notes.length) notes = allNotes.slice(); // fallback: todo
  }

  function barRangeChanged() {
    barStart = Math.max(1, Math.min(barStart, barsTotal));
    barEnd = Math.max(barStart, Math.min(barEnd, barsTotal));
    applyBarRange();
  }

  function selectAllBars() {
    barStart = 1;
    barEnd = barsTotal;
    applyBarRange();
  }

  // ---------- biblioteca ----------
  function loadFromLib(id) {
    const item = loadFromLibrary(id);
    if (!item) return;
    fileName = (item.source || item.name) + '';
    engineUsed = item.engine;
    importInfo = item.savedAt ? `guardada ${new Date(item.savedAt).toLocaleString()}` : '';
    finishLoad(item.notes, { engine: item.engine, tempo: item.tempo, fromLibrary: true });
    status = 'done';
  }

  function removeFromLib(id) {
    if (deleteFromLibrary(id)) refreshLibrary();
  }

  function fmtDur(s) {
    const tot = Math.round(s);
    const m = Math.floor(tot / 60);
    return m > 0 ? `${m}:${String(tot % 60).padStart(2, '0')}` : `${tot} s`;
  }

  // ---------- envío a QUIZ ----------
  function sendToQuiz() {
    if (!notes.length || !onSendToQuiz) return;
    const t0 = (barStart - 1) * secsPerBar;
    onSendToQuiz({
      name: (fileName.replace(/\.[^.]+$/, '') || 'Transcripción') +
        (barsTotal > 1 && (barStart !== 1 || barEnd !== barsTotal) ? ` (c.${barStart}-${barEnd})` : ''),
      notes: notes.map((n) => ({ ...n, startTime: Math.max(0, n.startTime - t0) })),
    });
  }

  function exportMidi() {
    if (!notes.length) return;
    downloadMidi(notes, (fileName.replace(/\.[^.]+$/, '') || 'basscoach') + '.mid');
  }
  function exportJson() {
    if (!notes.length) return;
    downloadJson(
      { source: fileName, engine: engineUsed, duration, tempo: tempoBpm, notes: notes.map((n) => ({ ...n, startTime: +(n.startTime).toFixed(3), duration: +(n.duration).toFixed(3) })) },
      (fileName.replace(/\.[^.]+$/, '') || 'basscoach') + '.json'
    );
  }

  function nm(midi) { return midiToName(midi, { latin, withOctave: true }); }

  $: totalNotes = notes.length;
  $: allCount = allNotes.length;
  $: density = duration > 0 ? (allCount / duration).toFixed(1) : '0';
</script>

<div class="panel">
  <h3>📝 Transcripción e importación (Audio/MIDI → Notas)</h3>
  <div class="sub">
    Sube una grabación de bajo (mp3/wav/ogg/m4a) o un <b>archivo MIDI (.mid)</b> · la IA Basic Pitch
    transcribe el audio; el MIDI se parsea directo · todo queda guardado en tu biblioteca local
  </div>

  <div
    class="dropzone {dragging ? 'over' : ''}"
    role="button" tabindex="0"
    on:click={() => inputEl && inputEl.click()}
    on:keydown={(e) => e.key === 'Enter' && inputEl && inputEl.click()}
    on:drop={onDrop} on:dragover={onDragOver} on:dragleave={onDragLeave}
  >
    {#if status === 'idle'}
      <div class="dz-icon">🎵</div>
      <div><b>Arrastra tu audio o MIDI de bajo aquí</b> o haz clic para elegir un archivo</div>
      <div class="sub">mp3 · wav · ogg · m4a · <b>.mid</b> — se procesa localmente en tu navegador, nada se sube a ningún servidor</div>
      <button class="small" on:click|stopPropagation={() => loadDemo()}>🎸 Probar demo (MIDI incluido)</button>
    {:else if status === 'decoding'}
      <div class="dz-icon spin">💿</div>
      <div>Decodificando <b>{fileName}</b>…</div>
    {:else if status === 'transcribing'}
      <div class="dz-icon spin">🧠</div>
      <div>Transcribiendo con {engineUsed === 'basic-pitch' ? 'Basic Pitch (IA)' : 'DSP YIN'}…</div>
      <div class="progressbar" style="margin-top: 10px; width: 70%">
        <div style="width: {progress}%"></div>
      </div>
      <div class="sub">{progress}%</div>
    {:else if status === 'importing'}
      <div class="dz-icon spin">🎼</div>
      <div>Importando MIDI <b>{fileName}</b>…</div>
    {:else if status === 'error'}
      <div class="dz-icon">⚠️</div>
      <div class="err-txt">{errorMsg}</div>
      <button style="margin-top: 8px" on:click={() => { status = 'idle'; file = null; }}>Intentar de nuevo</button>
    {:else}
      <div class="dz-icon ok">✅</div>
      <div><b>{fileName}</b> · {duration.toFixed(1)} s · {allCount} notas · motor: <span class="mono">{engineUsed}</span></div>
      {#if importInfo}
        <div class="sub">{importInfo}</div>
      {/if}
      <div class="row" style="justify-content: center; margin-top: 10px">
        {#if previewUrl}
          <audio controls src={previewUrl} style="height: 30px"></audio>
        {/if}
        <button on:click={() => { status = 'idle'; file = null; notes = []; allNotes = []; previewUrl = null; }}>↺ Otro archivo</button>
      </div>
    {/if}
    <input
      type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.mid,.midi"
      bind:this={inputEl}
      style="display: none"
      on:change={(e) => handleFiles(e.target.files)}
    />
  </div>

  {#if status === 'done' && allNotes.length}
    {#if barsTotal > 1}
      <div class="bar-selector">
        <span class="bs-label">🎚 Compases</span>
        <input type="number" min="1" max={barsTotal} bind:value={barStart} on:input={barRangeChanged} />
        <span>a</span>
        <input type="number" min={barStart} max={barsTotal} bind:value={barEnd} on:input={barRangeChanged} />
        <span class="dim">de {barsTotal}</span>
        <button on:click={selectAllBars}>Todo</button>
        <span class="dim" style="margin-left: auto">{totalNotes} notas seleccionadas · {secsPerBar.toFixed(2)} s/compás{tempoBpm ? ` @ ${tempoBpm} bpm` : ''}</span>
      </div>
    {/if}

    <div class="row" style="margin-top: 12px">
      <button class="primary" on:click={sendToQuiz}>🎮 Practicar en QUIZ</button>
      <button on:click={exportMidi}>⬇ MIDI</button>
      <button on:click={exportJson}>⬇ JSON</button>
      <div class="spacer"></div>
      <span class="sub">{density} notas/s</span>
    </div>

    <div class="notes-table">
      <div class="nt-head">
        <span>#</span><span>Nota</span><span>MIDI</span><span>Inicio (s)</span><span>Duración (s)</span>
      </div>
      <div class="nt-body">
        {#each notes.slice(0, 400) as n, i}
          <div class="nt-row">
            <span class="dim">{i + 1}</span>
            <span class="nm">{nm(n.midi)}</span>
            <span class="mono">{n.midi}</span>
            <span class="mono">{n.startTime.toFixed(2)}</span>
            <span class="mono">{n.duration.toFixed(2)}</span>
          </div>
        {/each}
        {#if notes.length > 400}
          <div class="nt-row dim">… {notes.length - 400} notas más (exporta el JSON para verlas todas)</div>
        {/if}
      </div>
    </div>
  {:else if status === 'done' && !allNotes.length}
    <div class="panel" style="margin-top: 12px; border-color: var(--warn)">
      No se detectaron notas de bajo en el archivo. Prueba con una grabación más limpia,
      o con un MIDI que contenga una pista de notas.
    </div>
  {/if}

  {#if library.length}
    <div class="lib">
      <div class="lib-head">
        📚 Tu biblioteca <span class="dim">· {stats.count} secuencias · {stats.notes} notas · guardadas en este dispositivo</span>
      </div>
      <div class="lib-body">
        {#each library as item (item.id)}
          <div class="lib-item">
            <div class="li-main">
              <span class="li-name">{item.name}</span>
              <span class="dim">{item.noteCount} notas · {fmtDur(item.duration)} · {item.engine}{item.tempo ? ` · ${item.tempo} bpm` : ''} · {new Date(item.savedAt).toLocaleDateString()}</span>
            </div>
            <div class="li-actions">
              <button class="small" on:click={() => loadFromLib(item.id)}>▶ Cargar</button>
              <button class="small danger" on:click={() => removeFromLib(item.id)}>🗑</button>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .dz-icon { font-size: 30px; margin-bottom: 6px; }
  .dz-icon.spin { animation: dzspin 1.2s linear infinite; display: inline-block; }
  .dz-icon.ok { color: var(--ok); }
  @keyframes dzspin { to { transform: rotate(360deg); } }
  .err-txt { color: var(--err); }
  .spacer { flex: 1; }
  .mono { font-family: var(--mono); font-size: 12px; color: var(--fg-2); }
  .notes-table { margin-top: 12px; border: 1px solid var(--line); border-radius: var(--radius-s); overflow: hidden; }
  .nt-head, .nt-row {
    display: grid; grid-template-columns: 42px 90px 60px 1fr 1fr;
    gap: 8px; padding: 4px 10px; font-size: 12px; align-items: center;
  }
  .nt-head { background: var(--bg-3); color: var(--fg-3); font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
  .nt-body { max-height: 260px; overflow-y: auto; }
  .nt-row:nth-child(even) { background: rgba(255, 255, 255, 0.02); }
  .nt-row .nm { color: var(--scale-2); font-weight: 600; }
  .dim { color: var(--fg-3); }
  .bar-selector {
    display: flex; align-items: center; gap: 8px; margin-top: 12px;
    padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-s);
    font-size: 12px;
  }
  .bar-selector input[type="number"] {
    width: 64px; padding: 3px 6px; font-size: 12px;
  }
  .bs-label { font-weight: 600; }
  .lib { margin-top: 14px; border: 1px solid var(--line); border-radius: var(--radius-s); overflow: hidden; }
  .lib-head {
    padding: 8px 10px; background: var(--bg-3); font-size: 12px; font-weight: 600;
  }
  .lib-body { max-height: 200px; overflow-y: auto; }
  .lib-item { display: flex; align-items: center; gap: 10px; padding: 6px 10px; font-size: 12px; }
  .lib-item:nth-child(even) { background: rgba(255, 255, 255, 0.02); }
  .li-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .li-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .li-actions { display: flex; gap: 6px; }
  .small { padding: 3px 8px; font-size: 11px; }
  .danger { color: var(--err); }
</style>
