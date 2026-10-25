/* popup.js – Einstellungen pro Anbieter (Tarif, Kontextfenster, Offset). */
(() => {
  const CFG = window.TX_CONFIG;
  const wrap = document.getElementById('providers');
  const status = document.getElementById('status');
  const get = (k) => new Promise((r) => chrome.storage.local.get(k, r));
  const set = (o) => new Promise((r) => chrome.storage.local.set(o, r));
  const say = (t) => {
    status.textContent = t;
    setTimeout(() => (status.textContent = ''), 2500);
  };

  async function init() {
    const d = await get(['tx_settings']);
    const settings = d.tx_settings || {};

    CFG.providers.forEach((p) => {
      const s = settings[p.id] || {};
      const fs = document.createElement('fieldset');
      const lg = document.createElement('legend');
      lg.textContent = p.name;
      fs.append(lg);

      const field = (label, el) => {
        const l = document.createElement('label');
        l.append(document.createTextNode(label), el);
        fs.append(l);
      };

      const sel = document.createElement('select');
      p.plans.forEach((pl) => {
        const o = document.createElement('option');
        o.value = pl.id;
        o.textContent = pl.label;
        sel.append(o);
      });
      sel.value = s.plan || p.defaultPlan;

      const mode = document.createElement('select');
      [['auto', 'Automatisch (Modell / Schätzwert)'], ['manual', 'Manuell festlegen']].forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        mode.append(o);
      });
      mode.value = s.windowMode || 'auto';

      const win = document.createElement('input');
      win.type = 'number';
      win.min = '1000';
      win.placeholder = p.defaultContextWindow ? String(p.defaultContextWindow) : 'nicht festgelegt';
      win.value = s.contextWindow || '';

      const off = document.createElement('input');
      off.type = 'number';
      off.min = '0';
      off.placeholder = `auto (${p.defaultOffset})`;
      off.value = s.offset === undefined || s.offset === null ? '' : s.offset;

      field('Tarif', sel);
      field('Fenster-Erkennung', mode);
      field('Kontextfenster (Fallback / manuell)', win);
      field('Unsichtbar (Offset)', off);
      wrap.append(fs);

      const save = async (planChanged = false) => {
        const cur = (await get(['tx_settings'])).tx_settings || {};
        const previous = cur[p.id] || {};
        cur[p.id] = {
          ...previous,
          plan: sel.value,
          planExplicit: planChanged ? true : (previous.planExplicit ?? Boolean(previous.plan)),
          windowMode: mode.value,
          contextWindow: win.value ? Number(win.value) : undefined,
          offset: off.value === '' ? undefined : Number(off.value)
        };
        await set({ tx_settings: cur });
        say('Gespeichert');
      };
      sel.addEventListener('change', () => save(true));
      [mode, win, off].forEach((el) => el.addEventListener('change', () => save(false)));
    });

    document.getElementById('reset-calib').addEventListener('click', async () => {
      await set({ tx_calib: {} });
      say('Kalibrierung zurückgesetzt');
    });
    document.getElementById('reset-turns').addEventListener('click', async () => {
      await set({ tx_turns: [] });
      say('Verlauf gelöscht');
    });
  }
  init();
})();
