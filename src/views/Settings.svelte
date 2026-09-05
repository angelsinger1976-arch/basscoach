<script>
  // ============================================================
  // BassCoach · Ajustes (motor de audio, entrada y API key)
  // - Dispositivo de entrada (mic o LINE IN de la interfaz
  //   de audio del bajo) con etiquetas y medidor de nivel.
  // - API key opcional (se guarda SOLO en este dispositivo;
  //   la app funciona 100% offline y no la envía a ningún
  //   servidor — preparada si en el futuro se integra algún
  //   servicio externo).
  // - Parámetros del detector YIN y validación.
  // ============================================================
  import { onDestroy, onMount } from 'svelte';
  import { TUNINGS } from '../lib/theory.js';

  export let settings = {
    lowpassHz: 500,
    centsTolerance: 25,
    windowMs: 96,
    hopMs: 24,
    rmsGate: 0.008,
    minConfidence: 0.55,
    stableFrames: 2,
    octaveStrict: false,
    holdMs: 120,
  };
  export let engineOn = false;
  export let onChange = null;
  export let onRestartMic = null;

  // ---------- API key ----------
  const API_KEY_STORE = 'basscoach.apiKey';
  let apiKey = '';
  let showKey = false;
  let keyStatus = ''; // '' | 'saved' | 'cleared'

  // ---------- Dispositivos de entrada ----------
  let devices = [];
  let testingLevel = false;
  let levelTimer = null;
  let liveRms = 0;

  onMount(async () => {
    try {
      apiKey = localStorage.getItem(API_KEY_STORE) || '';
    } catch {}
    try {
      if (navigator.mediaDevices) {
        devices = await navigator.mediaDevices.enumerateDevices();
      }
    } catch {}
  });

  onDestroy(() => {
    if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
  });

  function emit() {
    if (onChange) onChange({ ...settings });
  }

  async function refreshDevices() {
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
  }

  // ---------- API key ----------
  function saveKey() {
    try {
      if (apiKey.trim()) {
        localStorage.setItem(API_KEY_STORE, apiKey.trim());
        keyStatus = 'saved';
      } else {
        localStorage.removeItem(API_KEY_STORE);
        keyStatus = 'cleared';
      }
      setTimeout(() => (keyStatus = ''), 2000);
    } catch {
      keyStatus = 'error';
    }
  }

  // ---------- Medidor de nivel de entrada ----------
  async function testInput() {
    if (testingLevel) {
      testingLevel = false;
      if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
      liveRms = 0;
      return;
    }
    try {
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testingLevel = true;
      refreshDevices(); // tras permiso las etiquetas aparecen
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        liveRms = Math.sqrt(sum / buf.length);
      };
      levelTimer = setInterval(tick, 100);
      levelCtx = ctx; levelStream = stream;
    } catch (err) {
      console.error(err);
      testingLevel = false;
    }
  }
  let levelCtx = null;
  let levelStream = null;

  onDestroy(() => {
    if (levelCtx) {
      try { levelStream.getTracks().forEach((t) => t.stop()); } catch {}
      try { levelCtx.close(); } catch {}
    }
  });
</script>

<div class="panel">
  <h3>⚙️ Ajustes</h3>
  <div class="sub">
    {#if engineOn}
      Algunos cambios requieren reiniciar el micrófono.
    {:else}
      Activa el micrófono para enumerar dispositivos con etiquetas (o usa «Probar entrada»).
    {/if}
  </div>

  <!-- ============ API key ============ -->
  <div class="section">
    <div class="section-title">🔑 API key (opcional)</div>
    <div class="sub">
      Se guarda <b>solo en este dispositivo</b> (localStorage). BassCoach es 100% local/offline
      y <b>no envía la clave a ningún servidor</b> — queda lista si algún día conectas un servicio externo.
    </div>
    <div class="row" style="gap: 6px; margin-top: 8px">
      {#if showKey}
        <input
          type="text"
          value={apiKey}
          placeholder="Pega aquí tu API key…"
          class="key-input"
          autocomplete="off"
          spellcheck="false"
          on:input={(e) => (apiKey = e.target.value)}
          on:change={saveKey}
          on:keydown={(e) => e.key === 'Enter' && saveKey()}
        />
      {:else}
        <input
          type="password"
          value={apiKey}
          placeholder="Pega aquí tu API key…"
          class="key-input"
          autocomplete="off"
          spellcheck="false"
          on:input={(e) => (apiKey = e.target.value)}
          on:change={saveKey}
          on:keydown={(e) => e.key === 'Enter' && saveKey()}
        />
      {/if}
      <button on:click={() => (showKey = !showKey)} title="Mostrar/ocultar">{showKey ? '🙈' : '👁'}</button>
      <button class="primary" on:click={saveKey}>Guardar</button>
      {#if keyStatus === 'saved'}<span class="ok-txt">✓ guardada</span>{/if}
      {#if keyStatus === 'cleared'}<span class="ok-txt">✓ vaciada</span>{/if}
      {#if keyStatus === 'error'}<span class="err-txt">error al guardar</span>{/if}
    </div>
  </div>

  <!-- ============ Entrada de audio del bajo ============ -->
  <div class="section">
    <div class="section-title">🎸 Entrada de audio del bajo (line-in / micro)</div>
    <div class="sub">
      Elige el dispositivo por donde entra tu bajo: la <b>interfaz USB</b> (line-in),
      un <b>mic de contacto</b> o el micro del ordenador. Usa «Probar entrada» y toca una cuerda
      al aire para ver el nivel y confirmar que escucha por ahí.
    </div>
    <div class="row" style="gap: 6px; margin-top: 8px">
      <select bind:value={settings.deviceId} on:change={() => { emit(); refreshDevices(); }} style="flex: 1">
        <option value="">Por defecto del sistema</option>
        {#each devices as d}
          {#if d.kind === 'audioinput'}
            <option value={d.deviceId}>{d.label || `Entrada ${d.deviceId.slice(0, 6)}`}</option>
          {/if}
        {/each}
      </select>
      <button on:click={refreshDevices} title="Volver a listar dispositivos">↻</button>
      <button class="{testingLevel ? 'danger' : ''}" on:click={testInput}>
        {testingLevel ? '■ Parar prueba' : '▶ Probar entrada'}
      </button>
    </div>
    {#if testingLevel}
      <div class="level-wrap">
        <div class="level-bar"><div class="level-fill" style="width: {Math.min(100, liveRms * 400)}%"></div></div>
        <span class="hint mono">RMS {(liveRms * 100).toFixed(1)}% — toca la cuerda más grave al aire</span>
      </div>
      {#if liveRms * 400 < 3}
        <div class="hint warn-txt">Sin señal: prueba otro dispositivo de la lista o sube el volumen de la interfaz.</div>
      {:else if liveRms * 400 > 85}
        <div class="hint warn-txt">Satura: baja la ganancia de la interfaz para evitar recorte.</div>
      {/if}
    {/if}
  </div>

  <!-- ============ Motor de audio ============ -->
  <div class="section">
    <div class="section-title">🎚 Motor de detección (YIN)</div>
    <div class="settings-grid">
      <div class="setting">
        <label>Afinación del diapasón</label>
        <select bind:value={settings.tuning} on:change={emit}>
          {#each Object.entries(TUNINGS) as [k, t]}
            <option value={k}>{t.name}</option>
          {/each}
        </select>
        <span class="hint">También hay una pestaña dedicada: <b>AFINADO</b> 🎸</span>
      </div>

      <div class="setting">
        <label>Filtro paso bajo · <span class="val">{settings.lowpassHz} Hz</span></label>
        <input type="range" min="200" max="1200" step="20" bind:value={settings.lowpassHz} on:input={emit} />
        <span class="hint">Aísla los graves antes del detector (500 Hz recomendado para bajo)</span>
      </div>

      <div class="setting">
        <label>Tolerancia de afinación · <span class="val">±{settings.centsTolerance} cents</span></label>
        <input type="range" min="5" max="60" step="5" bind:value={settings.centsTolerance} on:input={emit} />
        <span class="hint">Margen para dar la nota por buena (15–25 típico)</span>
      </div>

      <div class="setting">
        <label>Ventana YIN · <span class="val">{settings.windowMs} ms</span></label>
        <input type="range" min="64" max="160" step="8" bind:value={settings.windowMs} on:input={emit} />
        <span class="hint">Más ventana = más estable en subgraves (B0 necesita ≥ 96 ms)</span>
      </div>

      <div class="setting">
        <label>Estabilización · <span class="val">{settings.stableFrames} frames</span></label>
        <input type="range" min="1" max="5" step="1" bind:value={settings.stableFrames} on:input={emit} />
        <span class="hint">Frames iguales consecutivos para aceptar la nota (ignora el ataque)</span>
      </div>

      <div class="setting">
        <label>Umbral de señal RMS · <span class="val">{settings.rmsGate.toFixed(3)}</span></label>
        <input type="range" min="0.002" max="0.05" step="0.002" bind:value={settings.rmsGate} on:input={emit} />
        <span class="hint">Sube si hay ruido de fondo; baja si el bajo es suave</span>
      </div>

      <div class="setting">
        <label>Umbral de confianza YIN · <span class="val">{settings.minConfidence.toFixed(2)}</span></label>
        <input type="range" min="0.3" max="0.9" step="0.05" bind:value={settings.minConfidence} on:input={emit} />
      </div>

      <div class="setting">
        <label>Sostener acierto · <span class="val">{settings.holdMs} ms</span></label>
        <input type="range" min="0" max="400" step="20" bind:value={settings.holdMs} on:input={emit} />
        <span class="hint">Cuánto debe sostenerse la nota correcta antes de avanzar</span>
      </div>

      <div class="setting">
        <label>Validación de octava</label>
        <div class="row" style="gap: 8px">
          <span class="switch {settings.octaveStrict ? 'on' : ''}" role="switch" tabindex="0"
            on:click={() => { settings.octaveStrict = !settings.octaveStrict; emit(); }}
            on:keydown={(e) => e.key === 'Enter' && ((settings.octaveStrict = !settings.octaveStrict), emit())}
          ></span>
          <span class="hint">{settings.octaveStrict ? 'Exige la octava exacta de la posición' : 'Cualquier octava de la nota valida (recomendado)'}</span>
        </div>
      </div>
    </div>
  </div>

  {#if engineOn && onRestartMic}
    <div class="row" style="margin-top: 14px">
      <button on:click={onRestartMic}>↻ Reiniciar micrófono con nueva configuración</button>
    </div>
  {/if}
</div>

<style>
  .section { margin-top: 16px; }
  .section-title { font-size: 13px; font-weight: 700; color: var(--accent, #b18cff); letter-spacing: 0.4px; margin-bottom: 2px; }
  .hint { font-size: 10.5px; color: var(--fg-3, #9a94a8); }
  .val { color: var(--accent, #b18cff); font-family: var(--mono, monospace); }
  .key-input { flex: 1; min-width: 0; }
  .ok-txt { color: var(--ok, #7ee787); font-size: 11px; }
  .err-txt { color: var(--err, #ff7b72); font-size: 11px; }
  .level-wrap { margin-top: 10px; display: flex; align-items: center; gap: 10px; }
  .level-bar { flex: 1; height: 12px; border-radius: 6px; background: #2a2438; overflow: hidden; border: 1px solid #3a3450; }
  .level-fill { height: 100%; background: linear-gradient(90deg, #7ee787 0%, #ffd866 70%, #ff7b72 100%); transition: width 0.08s linear; }
  .mono { font-family: var(--mono, monospace); }
</style>
