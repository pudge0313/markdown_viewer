'use strict';
/* 图片放大：滚轮缩放、拖拽平移、Esc 关闭 */
(function () {
  const MDV = window.MDV;
  const { $ } = MDV;
  const box = $('#lightbox');
  const img = $('#lightbox-img');
  const tip = $('#lightbox-tip');

  let scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0;

  function apply() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    tip.textContent = Math.round(scale * 100) + '%';
  }

  function reset() { scale = 1; tx = 0; ty = 0; apply(); }

  function open(src, alt) {
    img.src = src;
    img.alt = alt || '';
    box.hidden = false;
    reset();
    document.body.classList.add('lightbox-open');
  }

  function close() {
    box.hidden = true;
    img.removeAttribute('src');
    document.body.classList.remove('lightbox-open');
  }

  box.addEventListener('click', (e) => {
    if (e.target === box || e.target === img) {
      if (dragging) return;
      close();
    }
  });

  box.addEventListener('wheel', (e) => {
    e.preventDefault();
    const next = MDV.clamp(scale * (e.deltaY < 0 ? 1.12 : 0.89), 0.2, 8);
    scale = next;
    apply();
  }, { passive: false });

  img.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = false;
    sx = e.clientX - tx;
    sy = e.clientY - ty;
    const move = (ev) => {
      dragging = true;
      tx = ev.clientX - sx;
      ty = ev.clientY - sy;
      apply();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setTimeout(() => { dragging = false; }, 0);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  img.addEventListener('dblclick', reset);

  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === '+' || e.key === '=') { scale = MDV.clamp(scale * 1.15, 0.2, 8); apply(); }
    else if (e.key === '-') { scale = MDV.clamp(scale / 1.15, 0.2, 8); apply(); }
    else if (e.key === '0') reset();
  }, true);

  MDV.lightbox = { open, close };
})();
