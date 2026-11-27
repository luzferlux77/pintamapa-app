# Novedades de PintaMapa

## v0.9.39 · 27 de noviembre de 2026
- Barrios oficiales INE 2025 calle a calle en Cataluña y España (+312 ciudades nuevas, 372 totales en España y 7 barrios oficiales de Cornellà incluida la Gavarra) y contorno de barrio discreto bajo lo pintado

## v0.9.38 · 27 de noviembre de 2026
- Corrección de arranque en main.js (declaración temprana de esc antes de inicializar el marcador del jugador)

## v0.9.37 · 27 de noviembre de 2026
- Rediseño UI y dopamina v0.9.37: captura con anillo radial y ticks 3-2-1, combo con mecha de 12s, radar con objetivo fijado, portada 1-toque con racha semanal, resumen visual con mini-mapa, cofre interactivo con escudo de racha, modo oscuro en replay + 6 barrios oficiales de Cornellà con polígonos reales y limpieza global de 1.049 barrios y álbumes

## v0.9.36 · 26 de noviembre de 2026
- Correcciones forenses de paseos y nube: ruptura de ciclos en lmGone, filtro anti-deriva con lookahead en forense.js, fórmula real de señal GPS, sync 60s con PBKDF2 diferido, reintento de Overpass y saneo de listeners y PmMotorGps

## v0.9.35 · 25 de noviembre de 2026
- Motor de lugares mejorado: museos reconvertidos, sin falsos estadios ni autodestrucción de cartas, poda de POIs en teselas, 4 Twemoji nuevos, limpieza de marcadores fantasma y álbumes clave actualizados

## v0.9.34 · 24 de noviembre de 2026
- Barrios y cromos corregidos (Sant Ildefons, Fontsanta-Fatjó, aislamiento municipal y portada de Cornellà) + auditoría forense profunda (GPS, huecos de vehículo, álbumes, teselas y depuración)

## v0.9.33 · 23 de noviembre de 2026
- Corrección crítica de detección de barrios (Overpass ya no sobrescribe los nodos de barrio OpenFreeMap en caché, quarter y neighbourhood compiten por distancia real —la Gavarra y Almeda en Cornellà—, actualización inmediata del HUD y orden exacto por cartas en álbumes)

## v0.9.32 · 23 de noviembre de 2026
- Álbumes reorganizados sin scroll tedioso (activas ordenadas por progreso, recién pisadas plegadas, una sola barra fija, acordeones por distrito/barrio, fichas compactas para pendientes, rareza visible en conquistados, colecciones clicables y barrios en progreso) y parches críticos de GPS nativo, forense, sincronización, HUD e iconos SVG

## v0.1.0 · 11 de octubre de 2026
- Primer prototipo: pinta las calles reales que recorres, conquista barrios y ciudades (80 %), monumentos coleccionables, botes de pintura, combos, misiones diarias y logros.
- Paseos con empezar / pausar / finalizar y GPS en segundo plano con poco gasto de batería.
- Perfil Real (GPS, sincronizado con tu PC) separado del perfil de Prueba (simulación).
- Mapa con norte fijo o girando hacia donde andas. Avenidas anchas: basta una acera.
- Actualizaciones automáticas desde GitHub.
