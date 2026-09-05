# BassCoach — Tarea: ajustes de app (API key + line-in + pestaña AFINADO) + GitHub

## 1. Investigación
- [x] Leer Settings.svelte (ya tiene deviceId + tuning), App.svelte (flujo settings/tuning), AudioEngine (constraints getUserMedia), TUNINGS (6 afinados)

## 2. Página AJUSTES: API key + line-in mejorado
- [x] Añadir campo API key (guardado local, nunca se envía: app es 100% local) con mostrar/ocultar y probar
- [x] Sección "Entrada de audio del bajo" propia: listar dispositivos con etiquetas, refrescar, probar nivel de entrada (medidor en vivo) para elegir el line-in correcto
- [x] Guardar deviceId en settings (persistente)

## 3. Pestaña AFINADO (nueva)
- [x] Crear src/views/Tuning.svelte: selección de afinado (6 presets), vista del diapasón con las cuerdas al aire, pantalla de afinar por cuerda (Hz/cents/nota viva del motor)
- [x] Añadir pestaña "AFINADO" en App.svelte (entre TUNER y METRO) y montar la vista

## 4. Persistencia de settings
- [x] settings + tuning persistir en localStorage (recargar mantiene ajustes)

## 5. Tests + build + E2E
- [x] npm test (193) + build OK
- [x] E2E navegador: pestaña AFINADO render, pick de afinado cambia diapasón, settings persisten tras recargar, API key input funciona

## 6. GitHub
- [x] Commit + push main (angelsinger1976-arch/basscoach)
- [x] Rebuild gh-pages + force-push + verificar Pages vivo E2E
- [x] Zip + entrega final con URLs
