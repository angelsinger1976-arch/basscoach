<script>
  // ============================================================
  // BassCoach · Vista AFINADO (selección de afinado)
  // - Elige el afinado del diapasón (6 presets) → se aplica a
  //   TODA la app (STUDIO, QUIZ, TUNER, TRANSCRIPTION).
  // - Mini afinador por cuerda: toca cualquier cuerda y te
  //   dice qué cuerda es y qué tan cerca está (Hz/cents).
  // - Persistente: tu afinado se guarda en este dispositivo.
  // ============================================================
  import { midiToFreq, midiToName, TUNINGS, tuningMidis } from '../lib/theory.js';

  export let tuning = 'std4';
  export let latin = true;
  export let live = null;        // {f0, confidence, rms, midi, cents} del motor
  export let onTuningChange = null;

  $: strings = tuningMidis(tuning);
  $: keys = Object.keys(TUNINGS);
  $: detected = detectedString(live?.f0);

  function detectedString(f0) {
    if (!f0 || f0 <= 0) return null;
    let best = null;
    for (const m of strings) {
      const target = midiToFreq(m);
      const cents = 1200 * Math.log2(f0 / target);
      if (Math.abs(cents) <= 300 && (!best || Math.abs(cents) < Math.abs(best.cents))) {
        best = { midi: m, cents, target };
      }
    }
    return best;
  }

  function pick(k) {
    tuning = k;
    if (onTuningChange) onTuningChange(k);
  }

  // estado visual por cuerda: ok / cerca / lejos
  function stateFor(m) {
    if (!detected) return 'idle';
    if (detected.midi !== m) return 'idle';
    if (Math.abs(detected.cents) <= 8) return 'ok';
    return 'near';
  }
  function fmtCents(c) {
    const a = Math.round(c);
    return a > 0 ? `+${a}` : `${a}`;
  }
</script>

<div class="panel tuning-panel">
  <h3>🎸 Afinado del bajo</h3>
  <div class="sub">
    Elige el afinado: se aplica a toda la app (diapasón, QUIZ, afinador, transcripción)
    · se guarda en este dispositivo
  </div>

  <!-- ============ Selector de afinado ============ -->
  <div class="tunings">
    {#each keys as k}
      <button class="tuning-card {k === tuning ? 'on' : ''}" on:click={() => pick(k)}>
        <div class="tc-name">{TUNINGS[k].name}</div>
        <div class="tc-strings">
          {#each tuningMidis(k).slice().reverse() as m}
            <span class="tc-note">{midiToName(m, { latin, withOctave: true })}</span>
          {/each}
        </div>
        <div class="tc-hz">{#each tuningMidis(k).slice().reverse() as m}<span>{midiToFreq(m).toFixed(1)}</span>{/each}</div>
      </button>
    {/each}
  </div>

  <!-- ============ Diapasón del afinado elegido ============ -->
  <div class="fretboard-card">
    <div class="fb-title">Diapasón · {TUNINGS[tuning]?.name} · cuerdas al aire</div>
    <div class="fb-strings">
      {#each strings.slice().reverse() as m, i}
        {@const sIdx = strings.length - 1 - i}
        <div class="fb-string {stateFor(m)}">
          <span class="fs-name">{midiToName(m, { latin, withOctave: true })}</span>
          <span class="fs-hz mono">{midiToFreq(m).toFixed(2)} Hz</span>
          {#if detected && detected.midi === m}
            <span class="fs-cents {Math.abs(detected.cents) <= 8 ? 'ok' : 'warn'}">
              {fmtCents(detected.cents)} cents {detected.cents > 0 ? '↑ sube' : '↓ baja'}
            </span>
          {:else}
            <span class="fs-cents dim">cuerda {sIdx + 1}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- ============ Mini afinador en vivo ============ -->
  <div class="live-card">
    <div class="lc-title">Afinación en vivo</div>
    {#if detected}
      <div class="lc-main">
        <div class="lc-note {Math.abs(detected.cents) <= 8 ? 'ok' : ''}">
          {midiToName(detected.midi, { latin, withOctave: true })}
        </div>
        <div class="lc-hz mono">{live.f0.toFixed(2)} Hz · objetivo {detected.target.toFixed(2)} Hz</div>
        <div class="lc-bar">
          <div class="lc-fill" style="width: {Math.max(4, Math.min(100, ((Math.max(-50, Math.min(50, detected.cents)) + 50) / 100) * 100))}%"></div>
        </div>
        <div class="lc-cents">{fmtCents(detected.cents)} cents {Math.abs(detected.cents) <= 8 ? '✓ afinada' : (detected.cents > 0 ? '— demasiado alta' : '— demasiado baja')}</div>
      </div>
    {:else if live}
      <div class="sub">Señal: {live.rms?.toFixed(4) ?? '—'} · toca una cuerda al aire (grave primero)</div>
    {:else}
      <div class="sub">Activa el micrófono (🎙 arriba) para afinar en vivo</div>
    {/if}
  </div>
</div>

<style>
  .tunings { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; margin-top: 14px; }
  .tuning-card {
    background: #241f33; border: 1px solid #3a3450; border-radius: 12px; padding: 12px;
    color: var(--fg-2, #d6d2e0); cursor: pointer; text-align: left; transition: border-color 0.15s, transform 0.1s;
  }
  .tuning-card:hover { border-color: #7d5fff; transform: translateY(-1px); }
  .tuning-card.on { border-color: #b18cff; background: #2d2447; box-shadow: 0 0 0 1px #b18cff inset; }
  .tc-name { font-weight: 700; font-size: 13px; margin-bottom: 6px; }
  .tuning-card.on .tc-name { color: #b18cff; }
  .tc-strings { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
  .tc-note { font-size: 12px; font-family: var(--mono, monospace); background: #1a1626; border-radius: 6px; padding: 2px 7px; }
  .tc-hz { display: flex; gap: 6px; font-size: 10px; color: #9a94a8; font-family: var(--mono, monospace); }
  .tc-hz span { min-width: 40px; }

  .fretboard-card { margin-top: 16px; background: #1d1930; border: 1px solid #3a3450; border-radius: 12px; padding: 12px 14px; }
  .fb-title { font-size: 12px; font-weight: 600; color: #b18cff; margin-bottom: 10px; }
  .fb-strings { display: flex; flex-direction: column; gap: 6px; }
  .fb-string { display: flex; align-items: center; gap: 12px; background: #241f33; border-radius: 8px; padding: 7px 12px; border: 1px solid transparent; }
  .fb-string.ok { border-color: #7ee787; background: #1d2f26; }
  .fb-string.near { border-color: #ffd866; background: #2f2a1d; }
  .fs-name { font-weight: 700; font-size: 15px; min-width: 52px; }
  .fs-hz { font-size: 12px; color: #d6d2e0; }
  .fs-cents { font-size: 11.5px; margin-left: auto; }
  .fs-cents.ok { color: #7ee787; font-weight: 700; }
  .fs-cents.warn { color: #ffd866; font-weight: 700; }

  .live-card { margin-top: 16px; background: #1d1930; border: 1px solid #3a3450; border-radius: 12px; padding: 14px; }
  .lc-title { font-size: 12px; font-weight: 600; color: #b18cff; margin-bottom: 10px; }
  .lc-main { text-align: center; }
  .lc-note { font-size: 34px; font-weight: 800; }
  .lc-note.ok { color: #7ee787; text-shadow: 0 0 18px #7ee78755; }
  .lc-hz { font-size: 12px; color: #9a94a8; margin-top: 2px; }
  .lc-bar { height: 10px; border-radius: 5px; background: #2a2438; margin: 10px auto 4px; max-width: 420px; overflow: hidden; border: 1px solid #3a3450; }
  .lc-fill { height: 100%; background: linear-gradient(90deg, #ff7b72, #ffd866 50%, #7ee787); transition: width 0.1s linear; }
  .lc-cents { font-size: 12.5px; }
  .mono { font-family: var(--mono, monospace); }
  .dim { color: #9a94a8; }
</style>
