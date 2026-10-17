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
    // Mapa siempre en 2D desde arriba: sin edificios 3D (son lo más pesado de dibujar y daban tirones al arrastrar).
    // Los edificios se ven planos a cualquier zoom.
    for (const l of layers) {
      if (l.type === 'fill-extrusion') { try { map.removeLayer(l.id); } catch (e) {} }
      else if (l.type === 'fill' && /^building/.test(l.id)) { try { map.setLayerZoomRange(l.id, l.minzoom || 13, 24); map.setPaintProperty(l.id, 'fill-color', BLD[theme]); } catch (e) {} }
    }
  }
  return { URL, enhance };
})();
