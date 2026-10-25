/*
 * plans.js – zentrale Konfiguration der Extension.
 *
 * Alles, was sich bei einem Anbieter ändern kann (Selektoren, Tarife, Limits,
 * Fehlertexte), steht hier und nicht in content.js. Wenn die Anzeige plötzlich
 * nichts mehr findet, ist fast immer ein Selektor in diesem File veraltet.
 *
 * WICHTIG: Die Selektoren sind begründete Startwerte, ich konnte sie nicht gegen
 * die Live-Seiten prüfen. Bitte einmal in den DevTools kontrollieren
 * (document.querySelectorAll(<selektor>).length) und bei Bedarf anpassen.
 * Die Budgets pro Tarif sind Platzhalter, sie werden durch die Kalibrierung ersetzt.
 */
window.TX_CONFIG = {
  // Ab welchem Füllstand die Anzeige gelb bzw. rot wird (Anteil von 0 bis 1).
  thresholds: { warn: 0.7, crit: 0.9 },

  // Zeitwerte in Millisekunden.
  timing: {
    settleMs: 2200, // So lange muss die Seite ruhig sein, bis eine Antwort als fertig gilt.
    refreshDebounceMs: 300, // Wartezeit, bevor die Anzeige nach einer Änderung neu rechnet.
    tickMs: 15000, // Intervall für die Aktualisierung der Reset-Zeiten.
    noticeCooldownMs: 600000 // Pro Fehlermeldungsart wird höchstens alle 10 Minuten kalibriert.
  },

  // Heuristische Token-Schätzungen; ohne lokale Modell-Tokenizer nicht exakt oder statistisch validiert.
  estimator: {
    englishCharsPerToken: 4.0, // Unvalidierter Richtwert für englisch geprägten Text.
    germanCharsPerToken: 3.2, // Unvalidierter Richtwert für deutsch geprägten Text.
    codeCharsPerToken: 3.0, // Unvalidierter Richtwert für Code und strukturierte Daten.
    messageOverhead: 4, // Unvalidierter Zuschlag pro erkannter Nachricht.
    // Bild-Tokens je Anbieter aus Breite und Höhe. Formeln sind unvalidierte Näherungen.
    imageTokens(providerId, w, h) {
      if (providerId === 'claude') return null;
      if (providerId === 'chatgpt') {
        const k = Math.min(1, 2048 / Math.max(w, h));
        let sw = w * k;
        let sh = h * k;
        const s = Math.min(1, 768 / Math.min(sw, sh));
        sw *= s;
        sh *= s;
        return 85 + 170 * Math.ceil(sw / 512) * Math.ceil(sh / 512);
      }
      return w <= 384 && h <= 384 ? 258 : 258 * Math.ceil(w / 768) * Math.ceil(h / 768);
    }
  },

  // Verbrauchsmodell: Kosten einer Antwort = Kontext davor + Gewicht * Ausgabe.
  usage: {
    outputWeight: 1, // Gewicht der Ausgabe-Tokens gegenüber Eingabe-Tokens.
    historyLimit: 3000, // So viele Turns werden maximal gespeichert.
    calibSamples: 7 // So viele Kalibrierwerte pro Größe bleiben im Median.
  },

  providers: [
    {
      id: 'claude',
      name: 'Claude',
      hosts: ['claude.ai'],
      newChatPath: /^\/(new)?\/?$/, // Pfad einer leeren Startseite.
      selectors: {
        input: 'div[contenteditable="true"].ProseMirror, fieldset div[contenteditable="true"], div[contenteditable="true"][role="textbox"]',
        composer: 'fieldset, form',
        user: '[data-testid="user-message"]',
        assistant: '.font-claude-response, .font-claude-message, [data-testid="assistant-message"]',
        artifact: '[data-testid="artifact-content"], .artifact-content',
        streaming: '[data-is-streaming="true"]',
        model: '[data-testid="model-selector-dropdown"]'
      },
      modelScan: /\b(opus|sonnet|haiku|fable|mythos)\b/i,
      // Claude-Chat-Limits aus dem Help Center; nicht mit Claude Code/API-Werten vermischen.
      models: [
        { match: /fable\s*5\.1(?![\d])/i, window: { pro: 1000000, max5: 1000000, max20: 1000000 }, src: 'Claude Help Center · Claude-Chat, bezahlte Tarife' },
        { match: /fable\s*5(?![.\d])/i, window: { pro: 500000, max5: 500000, max20: 500000 }, src: 'Claude Help Center · Claude-Chat, bezahlte Tarife' },
        { match: /opus\s*5(?:\.5)?(?![.\d])/i, window: { pro: 1000000, max5: 1000000, max20: 1000000 }, src: 'Claude Help Center · Claude-Chat, bezahlte Tarife' },
        { match: /opus\s*4\.[678](?![\d])/i, window: { pro: 500000, max5: 500000, max20: 500000 }, src: 'Claude Help Center · Claude-Chat, bezahlte Tarife' },
        { match: /sonnet\s*5(?:\.5)?(?![.\d])/i, window: { pro: 1000000, max5: 1000000, max20: 1000000 }, src: 'Claude Help Center · Claude-Chat, bezahlte Tarife' },
        { match: /sonnet\s*4\.6(?![\d])/i, window: { pro: 500000, max5: 500000, max20: 500000 }, src: 'Claude Help Center · Claude-Chat, bezahlte Tarife' },
        { match: /haiku\s*5\.5(?![\d])/i, window: { pro: 1000000, max5: 1000000, max20: 1000000 }, src: 'Claude Help Center · Claude-Chat, bezahlte Tarife' }
      ],
      defaultContextWindow: null,
      otherModelContextWindow: 200000,
      defaultOffset: 3500, // Startwert für unsichtbare Tokens (System-Prompt, Tools, Memory).
      defaultPlan: 'unknown',
      // budget = Startwert in Kosten-Einheiten pro Fenster (Platzhalter bis zur Kalibrierung).
      plans: [
        { id: 'unknown', label: 'Unbekannt', paid: false },
        { id: 'free', label: 'Free', paid: false, budget: { session: 300000, week: 1500000 } },
        { id: 'pro', label: 'Pro', paid: true, budget: { session: 1500000, week: 9000000 } },
        { id: 'max5', label: 'Max (5x)', paid: true, budget: { session: 7500000, week: 45000000 } },
        { id: 'max20', label: 'Max (20x)', paid: true, budget: { session: 30000000, week: 180000000 } }
      ],
      windows: [
        { id: 'session', label: '5-Stunden-Limit', ms: 5 * 3600 * 1000 },
        { id: 'week', label: 'Wöchentlich', ms: 7 * 24 * 3600 * 1000, weekly: true }
      ],
      patterns: {
        usage: /(reached|hit|exceeded)[^.\n]{0,40}\blimit|\blimit\b[^.\n]{0,30}\b(reached|exceeded)|limit[^.\n]{0,20}erreicht|erreicht[^.\n]{0,40}limit/i,
        context: /(chat|conversation) (is|has become|was) too long|maximum length for this (chat|conversation)|(chat|unterhaltung|konversation) ist zu lang/i
      }
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      newChatPath: /^\/(\?.*)?$/,
      selectors: {
        input: '#prompt-textarea, [contenteditable="true"][role="textbox"], div[contenteditable="true"].ProseMirror',
        composer: 'form[data-type="unified-composer"]',
        // Die Rolle steht am Ende des data-content-search-unit-key; Turn-Status und Stop-Button erkennen Streaming.
        user: '[data-content-search-unit-key$=":user"]',
        assistant: '[data-content-search-unit-key$=":assistant"]',
        artifact: '#codemirror, [data-testid="canvas"]',
        streaming: '[data-talvt-turn-state="in_progress"], button[data-testid="stop-button"], button[aria-label*="Stop"]',
        model: 'button[data-testid="model-switcher-dropdown-button"]'
      },
      modelScan: /\b(gpt[- ]?\d|thinking|instant|reasoning)\b/i,
      models: [
        { match: /\bthinking\b|reasoning/i, window: { plus: 256000, pro: 400000 }, src: 'Drittquelle · unbestätigt' },
        { match: /\bpro\b/i, window: null, src: '' },
        { match: /instant|auto|gpt[- ]?\d/i, window: { free: 27000, plus: 54000, pro: 128000 }, src: 'Drittquelle · unbestätigt' }
      ],
      defaultContextWindow: 128000,
      defaultOffset: 2500,
      defaultPlan: 'plus',
      plans: [
        { id: 'free', label: 'Free', contextWindow: 27000, budget: { burst: 150000, day: 600000 } },
        { id: 'plus', label: 'Plus', contextWindow: 54000, budget: { burst: 2000000, day: 8000000 } },
        { id: 'pro', label: 'Pro', contextWindow: 128000, budget: { burst: 20000000, day: 80000000 } }
      ],
      windows: [
        { id: 'burst', label: '3-Stunden-Fenster', ms: 3 * 3600 * 1000 },
        { id: 'day', label: '24-Stunden-Fenster', ms: 24 * 3600 * 1000, weekly: true }
      ],
      patterns: {
        usage: /(reached|hit|exceeded)[^.\n]{0,40}\blimit|\blimit\b[^.\n]{0,30}\b(reached|exceeded)|limit[^.\n]{0,20}erreicht|erreicht[^.\n]{0,40}limit/i,
        context: /message (you submitted )?(was|is) too long|conversation is too long|(nachricht|unterhaltung) ist zu lang/i
      }
    },
    {
      id: 'gemini',
      name: 'Gemini',
      hosts: ['gemini.google.com'],
      newChatPath: /^(\/u\/\d+)?\/app\/?$/, // auch mit Konto-Präfix, z. B. /u/1/app
      selectors: {
        input: 'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"]',
        composer: 'input-area-v2, .input-area-container, form',
        user: 'user-query',
        assistant: 'model-response',
        artifact: 'code-immersive-panel, immersive-editor',
        streaming: 'button[aria-label*="Stop"], .stop-icon'
      },
      defaultContextWindow: 1000000,
      defaultOffset: 1500,
      defaultPlan: 'free',
      plans: [
        { id: 'free', label: 'Free', budget: { day: 2000000 } },
        { id: 'pro', label: 'AI Pro', budget: { day: 10000000 } },
        { id: 'ultra', label: 'AI Ultra', budget: { day: 40000000 } }
      ],
      windows: [{ id: 'day', label: 'Tageslimit', ms: 24 * 3600 * 1000 }],
      patterns: {
        usage: /(reached|hit|exceeded)[^.\n]{0,40}\blimit|\blimit\b[^.\n]{0,30}\b(reached|exceeded)|limit[^.\n]{0,20}erreicht|erreicht[^.\n]{0,40}limit/i,
        context: /(prompt|input|conversation) is too long|exceeds? the (context|token)|(eingabe|unterhaltung) ist zu lang/i
      }
    }
  ]
};
