// PintaMapa — foto de perfil personalizada (se guarda pequeña, en tu partida, y se sincroniza con la nube).
// main.js crea el módulo con PM.fun.create({...}).
PM.fun = (function () {
  function create(ctx) {
    const { S, toast, $ } = ctx;
    const safeAvatar = (v) => (v && /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(String(v)) ? String(v) : null);
    const safeColor = (v) => (v && /^#[0-9a-f]{3,8}$/i.test(String(v)) ? String(v) : '#2563eb');
    function avatarHTML(cls) {
      const s = S(), av = safeAvatar(s.avatar);
      return av ? `<div class="${cls} has-photo" style="background-image:url('${av}')"></div>` : `<div class="${cls}" style="background:${safeColor(s.color)}">🖌️</div>`;
    }
    // recorta al centro en cuadrado y la guarda en JPEG pequeño
    function squareJpeg(dataUrl, size) {
      return new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          const m = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = size; c.height = size;
          c.getContext('2d').drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, size, size);
          res(c.toDataURL('image/jpeg', 0.82));
        };
        im.onerror = () => res(null);
        im.src = dataUrl;
      });
    }
    async function changeAvatar() {
      let raw;
      try { raw = await PM.cards.takePhoto('Foto de perfil'); } catch (e) { return false; }
      if (!raw) return false;
      const img = await squareJpeg(raw, 320);
      if (!img) { toast('No se pudo leer la foto', 'warn'); return false; }
      S().avatar = img; S().avatarT = Date.now(); PM.state.save();
      refreshAvatar();
      toast('📸 Foto de perfil guardada', 'ok');
      return true;
    }
    function removeAvatar() { delete S().avatar; S().avatarT = Date.now(); PM.state.save(); refreshAvatar(); }
    function refreshAvatar() {
      const b = $('#nav-profile');
      if (!b) return;
      const av = safeAvatar(S().avatar);
      b.classList.toggle('has-avatar', !!av);
      b.style.setProperty('--avatar', av ? `url('${av}')` : 'none');
    }
    refreshAvatar();
    return { avatarHTML, changeAvatar, removeAvatar, refreshAvatar };
  }
  return { create };
})();
