// PintaMapa — estilo del mapa base: OpenFreeMap (datos de OpenStreetMap) con la paleta de PintaMapa encima.
// Claro: "Liberty" (con color) suavizado: suelo cálido, parques verdes, agua azul, edificios arena y en 3D al acercarse.
// Oscuro: "Dark" con agua, parques y edificios con un toque de color, y también 3D.
// Se ocultan los iconos de tiendas, paradas, etc.: en el mapa mandan tus lugares y lo que pintas.
PM.mapStyle = (function () {
  const URL = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
  const PAL = {
    light: [
      [/^background$/, 'background-color', '#f4f0e8'],
      [/^park$|landcover_grass|landuse_pitch|landcover-grass/, 'fill-color', '#cfe7bf'],
      [/landcover_wood|landcover-wood/, 'fill-color', '#bcdca6'],
      [/^water$/, 'fill-color', '#a6d4ef'],
      [/^waterway/, 'line-color', '#a6d4ef'],
      [/landuse_residential|landuse-residential/, 'fill-color', '#eee8dd'],
      [/landuse_(school|hospital)|landuse-(school|hospital)/, 'fill-color', '#f1e5d3'],
      [/landcover_sand/, 'fill-color', '#f2e4c0'],
      [/^building$/, 'fill-color', '#e4dccf'],
    ],
    dark: [
      [/^background$/, 'background-color', '#121822'],
      [/^water$/, 'fill-color', '#1b3247'],
      [/^waterway/, 'line-color', '#1b3247'],
      [/^park$|landcover_wood|landcover_grass|grass/, 'fill-color', '#18291f'],
      [/^building$/, 'fill-color', '#1e2532'],
    ],
  };
  const HIDE = /^poi[_-]|one_way_arrow|^airport$/;
  const BLD = { light: '#e8e1d5', dark: '#283142' };

  function enhance(map, theme) {
    const style = map.getStyle(), layers = style.layers || [];
    for (const l of layers) {
      if (HIDE.test(l.id)) { try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {} continue; }
      for (const [re, prop, val] of PAL[theme] || []) {
        if (re.test(l.id) && prop.startsWith(l.type + '-')) { try { map.setPaintProperty(l.id, prop, val); } catch (e) {} }
      }
    }
    // edificios en 3D (desde el zoom 15): el de Liberty se recolorea; en el oscuro se añade
    const ext = layers.find((l) => l.type === 'fill-extrusion');
    if (ext) {
      try { map.setPaintProperty(ext.id, 'fill-extrusion-color', BLD[theme]); map.setPaintProperty(ext.id, 'fill-extrusion-opacity', 0.85); } catch (e) {}
    } else {
      const src = Object.keys(style.sources).find((k) => style.sources[k].type === 'vector');
      const firstSym = layers.find((l) => l.type === 'symbol');
      if (src) try {
        map.addLayer({ id: 'pm-bld3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 15,
          paint: { 'fill-extrusion-color': BLD[theme], 'fill-extrusion-opacity': 0.8,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
        firstSym && firstSym.id);
      } catch (e) {}
    }
    // luz y cielo (se notan en la vista inclinada)
    try { map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: theme === 'dark' ? 0.25 : 0.4, position: [1.4, 210, 35] }); } catch (e) {}
    try {
      map.setSky(theme === 'dark'
        ? { 'sky-color': '#0b1220', 'horizon-color': '#1b2638', 'fog-color': '#121822', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.6 }
        : { 'sky-color': '#bcdcf5', 'horizon-color': '#f4f0e8', 'fog-color': '#f4f0e8', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5 });
    } catch (e) {}
  }
  return { URL, enhance };
})();
