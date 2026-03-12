(function () {
  'use strict';

  // Guard: only initialize once
  if (document.documentElement.hasAttribute('data-nf-widget')) return;
  document.documentElement.setAttribute('data-nf-widget', '1');

  var ROI_URL = 'https://neuralflow-roi-production.up.railway.app/roi-calculator';

  // ── Styles ──────────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#nf-roi-btn {',
    '  position: fixed;',
    '  bottom: 24px;',
    '  right: 24px;',
    '  z-index: 999998;',
    '  display: flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '  padding: 13px 20px;',
    '  background: #0a0a0f;',
    '  color: #ffffff;',
    '  border: 1.5px solid #00d4ff;',
    '  border-radius: 50px;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  font-size: 14px;',
    '  font-weight: 600;',
    '  letter-spacing: 0.2px;',
    '  cursor: pointer;',
    '  box-shadow: 0 0 18px rgba(0, 212, 255, 0.25), 0 4px 20px rgba(0,0,0,0.4);',
    '  transition: box-shadow 0.25s, transform 0.2s, border-color 0.25s;',
    '  white-space: nowrap;',
    '  user-select: none;',
    '  -webkit-user-select: none;',
    '}',
    '#nf-roi-btn:hover {',
    '  box-shadow: 0 0 28px rgba(0, 212, 255, 0.45), 0 6px 28px rgba(0,0,0,0.5);',
    '  transform: translateY(-2px);',
    '  border-color: #33ddff;',
    '}',
    '#nf-roi-btn:active {',
    '  transform: translateY(0);',
    '}',
    '#nf-roi-backdrop {',
    '  display: none;',
    '  position: fixed;',
    '  inset: 0;',
    '  z-index: 999999;',
    '  background: rgba(0, 0, 0, 0.75);',
    '  backdrop-filter: blur(6px);',
    '  -webkit-backdrop-filter: blur(6px);',
    '  align-items: center;',
    '  justify-content: center;',
    '  padding: 20px;',
    '}',
    '#nf-roi-backdrop.nf-open {',
    '  display: flex;',
    '}',
    '#nf-roi-modal {',
    '  position: relative;',
    '  width: 100%;',
    '  max-width: 900px;',
    '  height: 90vh;',
    '  background: #0a0a0f;',
    '  border: 1px solid rgba(255,255,255,0.1);',
    '  border-radius: 16px;',
    '  overflow: hidden;',
    '  box-shadow: 0 24px 80px rgba(0,0,0,0.7);',
    '  display: flex;',
    '  flex-direction: column;',
    '}',
    '#nf-roi-modal-header {',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: space-between;',
    '  padding: 14px 20px;',
    '  border-bottom: 1px solid rgba(255,255,255,0.07);',
    '  background: #0a0a0f;',
    '  flex-shrink: 0;',
    '}',
    '#nf-roi-modal-title {',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  color: rgba(255,255,255,0.6);',
    '  letter-spacing: 0.2px;',
    '}',
    '#nf-roi-close {',
    '  width: 32px;',
    '  height: 32px;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  background: rgba(255,255,255,0.06);',
    '  border: 1px solid rgba(255,255,255,0.1);',
    '  border-radius: 8px;',
    '  color: rgba(255,255,255,0.7);',
    '  font-size: 18px;',
    '  line-height: 1;',
    '  cursor: pointer;',
    '  transition: background 0.2s, color 0.2s;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '}',
    '#nf-roi-close:hover {',
    '  background: rgba(255,255,255,0.12);',
    '  color: #ffffff;',
    '}',
    '#nf-roi-iframe {',
    '  flex: 1;',
    '  width: 100%;',
    '  border: none;',
    '  display: block;',
    '  background: #0a0a0f;',
    '}',
    '@media (max-width: 600px) {',
    '  #nf-roi-btn {',
    '    bottom: 16px;',
    '    right: 16px;',
    '    padding: 11px 16px;',
    '    font-size: 13px;',
    '  }',
    '  #nf-roi-backdrop {',
    '    padding: 0;',
    '  }',
    '  #nf-roi-modal {',
    '    max-width: 100%;',
    '    height: 100dvh;',
    '    border-radius: 0;',
    '    border: none;',
    '  }',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  // ── Floating Button ──────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.id = 'nf-roi-btn';
  btn.setAttribute('aria-label', 'Calculate Your ROI');
  btn.innerHTML = '\uD83D\uDCB0 Calculate Your ROI';
  document.body.appendChild(btn);

  // ── Modal Backdrop ───────────────────────────────────────────────────────────
  var backdrop = document.createElement('div');
  backdrop.id = 'nf-roi-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'ROI Calculator');

  var modal = document.createElement('div');
  modal.id = 'nf-roi-modal';

  var header = document.createElement('div');
  header.id = 'nf-roi-modal-header';

  var title = document.createElement('span');
  title.id = 'nf-roi-modal-title';
  title.textContent = 'NeuralFlow ROI Calculator';

  var closeBtn = document.createElement('button');
  closeBtn.id = 'nf-roi-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '\u00D7';

  header.appendChild(title);
  header.appendChild(closeBtn);

  var iframe = document.createElement('iframe');
  iframe.id = 'nf-roi-iframe';
  iframe.setAttribute('title', 'NeuralFlow ROI Calculator');
  iframe.setAttribute('loading', 'lazy');
  // src intentionally not set until open — avoids loading on page load
  iframe.setAttribute('data-src', ROI_URL);

  modal.appendChild(header);
  modal.appendChild(iframe);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // ── Open / Close Logic ───────────────────────────────────────────────────────
  var iframeLoaded = false;

  function openModal() {
    if (!iframeLoaded) {
      iframe.src = iframe.getAttribute('data-src');
      iframeLoaded = true;
    }
    backdrop.classList.add('nf-open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function closeModal() {
    backdrop.classList.remove('nf-open');
    document.body.style.overflow = '';
    btn.focus();
  }

  btn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  // Close on backdrop click (outside modal)
  backdrop.addEventListener('click', function (e) {
    if (e.target === backdrop) closeModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && backdrop.classList.contains('nf-open')) {
      closeModal();
    }
  });

})();
