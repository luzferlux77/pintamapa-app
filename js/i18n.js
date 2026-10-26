// PintaMapa — motor de idiomas: castellano (el original), català, English y français.
//   PM.t('Texto en castellano', { n: 3 })  → la frase en el idioma elegido (con huecos {n}); si falta, en castellano
//   PM.i18n.dom(nodo)                       → traduce lo que se pinta en pantalla (textos y placeholder/title/aria-label)
// La pantalla se traduce sola: un vigilante (MutationObserver) traduce cada cosa que aparece, así no hay que tocar cada
// plantilla. Lo que no es pantalla (notificaciones de Android, lo dibujado en el vídeo, diálogos) pide PM.t() en el
// código. Los nombres de los lugares NO se traducen (van en elementos con translate="no" o class "notranslate").
// Diccionarios: www/js/i18n-ca.js, i18n-en.js, i18n-fr.js → PM.i18n.add(idioma, { 'castellano': 'traducción', '{n} paseos': '{n} walks' }).
window.PM = window.PM || {};
PM.i18n = (function () {
  const LANGS = { es: 'Castellano', ca: 'Català', en: 'English', fr: 'Français' };
  const KEY = 'pintamapa_lang';
  // idiomas que se pueden elegir: solo los que tienen el diccionario TERMINADO (un idioma a medias dejaba media app
  // en castellano). Al acabar uno, se añade aquí.
  const LISTOS = ['es', 'ca', 'en', 'fr'];
  const ELEGIBLES = Object.fromEntries(Object.entries(LANGS).filter(([k]) => LISTOS.includes(k)));
  const detect = () => { const n = String((navigator.languages && navigator.languages[0]) || navigator.language || 'es').slice(0, 2).toLowerCase(); return ELEGIBLES[n] ? n : 'es'; };
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) { /* sin almacenamiento */ }
  const lang = ELEGIBLES[stored] ? stored : detect();
  const DICT = { ca: Object.create(null), en: Object.create(null), fr: Object.create(null) };
  const PAT = { ca: [], en: [], fr: [] };
  const misses = new Set();
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
  // patrones con huecos: «{0} km caminados» → /^(.+?) km caminados$/ (se crean al añadir el diccionario)
  const toRe = (src) => new RegExp('^' + src.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\\{|\{(\w+)\}/g, (m, k) => (k != null ? '(.+?)' : m)) + '$');
  function add(l, dict) {
    if (!DICT[l]) return;
    for (const [es, tr] of Object.entries(dict || {})) {
      const k = norm(es);
      if (!/\{\w+\}/.test(k)) { DICT[l][k] = tr; continue; }
      // (un patrón necesita texto propio: «{a} {b}» lo cazaría todo)
      if ((k.replace(/\{\w+\}/g, '').match(/[a-záéíóúñ]/gi) || []).length < 2) continue;
      PAT[l].push({ re: toRe(k), keys: [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]), out: tr, lit: k.replace(/\{\w+\}/g, '').length });
    }
    // (del más específico al más genérico: «Camina {n}» no puede quedarse con «Camina 3 km en total»)
    PAT[l].sort((a, b) => b.lit - a.lit);
    memo.clear();
  }
  const memo = new Map();   // (lo ya buscado: el marcador se repinta cada segundo)
  function lookup(k) {
    const d = DICT[lang];
    if (d[k] != null) return d[k];
    if (memo.has(k)) return memo.get(k);
    let r = null;
    // (con un emoji o símbolo delante —«🎯 Captura 2 lugares», «❌ La copia…»—: primero se traduce el resto, con el
    // símbolo aparte; si no, un patrón genérico se quedaba el emoji y la mitad de la frase)
    const pre = /^([^\p{L}\p{N}]+\s)(\S.*)$/u.exec(k);
    if (pre) { const resto = lookup(pre[2]); if (resto != null) r = pre[1] + resto; }
    if (r == null) for (const p of PAT[lang]) {
      const m = p.re.exec(k);
      if (m) { let out = p.out; p.keys.forEach((name, i) => { const v = m[i + 1]; out = out.split('{' + name + '}').join(d[v] != null ? d[v] : v); }); r = out; break; }
    }
    if (memo.size > 4000) memo.clear();
    memo.set(k, r);
    return r;
  }
  // la frase en el idioma elegido; vars rellena los huecos {nombre}
  function t(s, vars) {
    if (s == null) return s;
    let r = String(s);
    if (lang !== 'es') {
      const k = norm(r), hit = k ? lookup(k) : null;
      if (hit != null) r = hit; else if (k && /[a-záéíóúñ]{2}/i.test(k)) misses.add(k);
    }
    if (vars) r = r.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? vars[name] : m));
    return r;
  }
  // ---- pantalla ----
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const skip = (el) => !!(el && el.closest && el.closest('[translate="no"], .notranslate, script, style, svg, canvas, textarea, .maplibregl-canvas-container'));
  function textNode(n) {
    const v = n.nodeValue;
    if (!v || !/[a-záéíóúñ]/i.test(v) || skip(n.parentElement)) return;
    const k = norm(v);
    if (n.__pm === k) return;   // (ya traducido)
    const hit = lookup(k);
    if (hit != null) { const lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0]; n.nodeValue = lead + hit + tail; n.__pm = norm(n.nodeValue); }
    else if (/[a-záéíóúñ]{2}/i.test(k)) misses.add(k);
  }
  function dom(root) {
    if (lang === 'es' || !root) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1 || skip(root)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) textNode(n);
    const els = [root, ...root.querySelectorAll('[placeholder],[title],[aria-label]')];
    for (const el of els) for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && !skip(el)) { const h = lookup(norm(v)); if (h != null) el.setAttribute(a, h); } }
  }
  function watch() {
    if (lang === 'es' || typeof MutationObserver === 'undefined') return;
    document.documentElement.lang = lang;
    document.title = t(document.title);
    // los diálogos del sistema (confirmar, avisar) tampoco son pantalla: se traducen al abrirse
    const conf = window.confirm, avis = window.alert;
    window.confirm = (m) => conf.call(window, t(m));
    window.alert = (m) => avis.call(window, t(m));
    dom(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') textNode(m.target);
        else m.addedNodes.forEach((n) => dom(n));
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function set(l) {
    if (!ELEGIBLES[l]) return;
    try { localStorage.setItem(KEY, l); } catch (e) { /* sin almacenamiento */ }
    if (l !== lang) location.reload();   // todo vuelve a salir ya en el idioma nuevo
  }
  // (con un solo idioma disponible no hay nada que elegir)
  const chosen = () => { if (LISTOS.length < 2) return true; try { return !!localStorage.getItem(KEY); } catch (e) { return true; } };
  // (desarrollo) frases que aún no tienen traducción en este idioma
  const pendientes = () => [...misses].sort();
  return { LANGS: ELEGIBLES, TODOS: LANGS, lang, chosen, set, t, add, dom, watch, pendientes };
})();
PM.t = PM.i18n.t;
// fechas y números a la manera de cada idioma
PM.LOCALE = { es: PM.LOCALE, ca: 'ca-ES', en: 'en-GB', fr: 'fr-FR' }[PM.i18n.lang];
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => PM.i18n.watch());
  else PM.i18n.watch();
}
