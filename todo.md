# BassCoach — Consolidar a UN solo branch + claridad de instalación

## 1. Verificación de estado
- [x] Revisar branches locales, remoto, token, sw.js cache y .gitignore
- [ ] Confirmar ramas exactas en GitHub (basscoach + salcidostudio-bass) y Pages source vía API

## 2. Consolidar basscoach a UN solo branch (main)
- [ ] Bump versión de caché del service worker (basscoach-v2 → usuarios PWA reciben update)
- [ ] Rebuild de dist
- [ ] Copiar dist/* → docs/ (con .nojekyll) en main, commit + push a basscoach
- [ ] Cambiar Pages source: gh-pages → main /docs (API PUT)
- [ ] Borrar branch gh-pages remoto (y limpiar ramas locales sobrantes)
- [ ] Verificar URL viva sirve la nueva compilación (E2E navegador)

## 3. Documentación y entrega
- [ ] Actualizar README (docs/, un solo branch, instrucciones de instalación claras)
- [ ] Regenerar basscoach.zip
- [ ] Commit final + push main
- [ ] Explicar al usuario qué versión usar (URL viva PWA / zip / branch único)
