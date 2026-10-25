(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.TX_CONTEXT_MODEL = model;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function estimateTokens(text, isCode, estimator) {
    if (typeof text !== 'string' || !text.trim()) return 0;
    const structuredText =
      isCode ||
      /(?:^\s*[\[{].*[\]}]\s*$)|(?:^\s*\|.+\|\s*$\n?){2,}/ms.test(text);
    const settings = estimator || {};
    const codeFactor = Number(settings.codeCharsPerToken) || 3;
    const englishFactor = Number(settings.englishCharsPerToken) || 4;
    const germanFactor = Number(settings.germanCharsPerToken) || 3.2;
    let codeUnits = 0;
    let wideTokens = 0;
    let previousWasJoiner = false;
    let regionalIndicators = 0;
    let germanWords = 0;
    let englishWords = 0;

    if (!structuredText) {
      germanWords = (text.match(/\b(der|die|das|und|ist|nicht|ich|ein|eine|mit|für|auf|zu|den|dem|von)\b/gi) || []).length;
      englishWords = (text.match(/\b(the|and|is|not|of|to|with|for|that|this|you|are|in)\b/gi) || []).length;
    }

    for (const character of text) {
      const point = character.codePointAt(0);
      if (point <= 0x2fff) {
        codeUnits += character.length;
        continue;
      }
      if (
        point === 0x200d ||
        point === 0xfe0e ||
        point === 0xfe0f ||
        (point >= 0x1f3fb && point <= 0x1f3ff) ||
        (point >= 0x0300 && point <= 0x036f)
      ) {
        previousWasJoiner = point === 0x200d;
        continue;
      }
      if (point >= 0x1f1e6 && point <= 0x1f1ff) {
        if (regionalIndicators % 2 === 0) wideTokens++;
        regionalIndicators++;
        previousWasJoiner = false;
        continue;
      }
      regionalIndicators = 0;
      if (!previousWasJoiner) wideTokens++;
      previousWasJoiner = false;
    }

    let charsPerToken = codeFactor;
    if (!structuredText) {
      const languageMarkers = germanWords + englishWords;
      charsPerToken = languageMarkers
        ? (germanWords * germanFactor + englishWords * englishFactor) / languageMarkers
        : englishFactor;
    }
    return Math.ceil(codeUnits / charsPerToken + wideTokens * 1.2);
  }

  function messageKey(role, text) {
    let value = 0x811c9dc5;
    const content = typeof text === 'string' ? text : '';
    for (let i = 0; i < content.length; i++) {
      value ^= content.charCodeAt(i);
      value = Math.imul(value, 0x01000193);
    }
    return `${role}:${(value >>> 0).toString(36)}`;
  }

  function countPdfPages(raw) {
    if (typeof raw !== 'string') return null;
    const matches = raw.match(/\/Type\s*\/Page(?!s)\b/g);
    return matches && matches.length ? matches.length : null;
  }

  function estimateImageTokens(providerId, width, height, estimate) {
    if (
      !Number.isFinite(width) ||
      width <= 0 ||
      !Number.isFinite(height) ||
      height <= 0 ||
      typeof estimate !== 'function'
    ) {
      return null;
    }
    const tokens = estimate(providerId, width, height);
    return Number.isFinite(tokens) && tokens >= 0 ? tokens : null;
  }

  function estimateMessageParts(prose, structuredParts, estimator, overhead) {
    const parts = structuredParts || [];
    return {
      prose: estimateTokens(prose, false, estimator) + (Number.isFinite(overhead) ? overhead : 0),
      code: parts.reduce((sum, part) => sum + estimateTokens(part, true, estimator), 0)
    };
  }

  function estimateTextAttachment(text, isCode, estimator, maxLength) {
    const limitedText = typeof text === 'string' ? text.slice(0, maxLength) : '';
    const truncated = typeof text === 'string' && limitedText.length < text.length;
    return {
      tokens: estimateTokens(limitedText, isCode, estimator),
      approx: true,
      truncated
    };
  }

  function sumAttachments(attachments) {
    return (attachments || []).reduce(
      (result, attachment) => {
        if (Number.isFinite(attachment && attachment.tokens) && attachment.tokens >= 0) {
          result.tokens += attachment.tokens;
        } else {
          result.unknownCount++;
        }
        if (attachment && attachment.approx) result.approximateCount++;
        return result;
      },
      { tokens: 0, unknownCount: 0, approximateCount: 0 }
    );
  }

  function estimatedUtilization(estimate, contextWindow, unknownParts = 0) {
    if (
      !Number.isFinite(estimate) ||
      estimate < 0 ||
      !Number.isFinite(contextWindow) ||
      contextWindow <= 0 ||
      unknownParts > 0
    ) {
      return null;
    }
    return Math.min(1, estimate / contextWindow);
  }

  function excludeContained(elements, containers) {
    return (elements || []).filter(
      (element) => !(containers || []).some((container) => container !== element && container.contains(element))
    );
  }

  function partitionStreamingMessage(messages, isStreaming, isUserMessage) {
    const last = messages && messages[messages.length - 1];
    const live = isStreaming && last && !isUserMessage(last) ? last : null;
    return { stored: (messages || []).filter((message) => message !== live), live };
  }

  function create({ transcriptEstimate, activeContextEstimate = null, contextWindow }) {
    return {
      transcriptEstimate: Number.isFinite(transcriptEstimate) && transcriptEstimate >= 0
        ? transcriptEstimate
        : null,
      activeContextEstimate: Number.isFinite(activeContextEstimate) && activeContextEstimate >= 0
        ? activeContextEstimate
        : null,
      contextWindow: Number.isFinite(contextWindow) && contextWindow > 0
        ? contextWindow
        : null
    };
  }

  function utilization(context) {
    if (
      !context ||
      !Number.isFinite(context.activeContextEstimate) ||
      !Number.isFinite(context.contextWindow) ||
      context.contextWindow <= 0
    ) {
      return null;
    }
    return Math.min(1, context.activeContextEstimate / context.contextWindow);
  }

  function resolveContextWindow({
    providerId,
    settings,
    plan,
    model,
    models,
    modelScan,
    defaultContextWindow,
    otherModelContextWindow,
    calibratedWindow
  }) {
    const configured = Number(settings && settings.contextWindow);
    const manual = Number.isFinite(configured) && configured > 0 ? configured : 0;
    if (settings && settings.windowMode === 'manual' && manual) {
      return { win: manual, src: 'Manuell festgelegt', known: true };
    }

    const label = model && (model.fullLabel || model.label || model);
    let matchedModel = false;
    if (label) {
      const hit = (models || []).find((entry) => {
        if (!entry || !entry.match) return false;
        entry.match.lastIndex = 0;
        return entry.match.test(label);
      });
      matchedModel = Boolean(hit);
      if (hit && hit.window !== null && hit.window !== undefined) {
        const value = typeof hit.window === 'object' ? hit.window[plan && plan.id] : hit.window;
        if (Number.isFinite(value) && value > 0) {
          return {
            win: value,
            src: hit.src || 'Modelltabelle',
            known: !/unbestätigt|nicht offiziell bestätigt/i.test(hit.src || '')
          };
        }
      }

      if (providerId === 'claude' && !matchedModel && plan && plan.paid && modelScan) {
        modelScan.lastIndex = 0;
        if (
          modelScan.test(label) &&
          Number.isFinite(otherModelContextWindow) &&
          otherModelContextWindow > 0
        ) {
          return {
            win: otherModelContextWindow,
            src: 'Claude Help Center · übrige Modelle auf bezahlten Chat-Tarifen',
            known: true
          };
        }
      }
    }

    if (providerId === 'claude') {
      if (manual) return { win: manual, src: 'Fallback aus den Einstellungen', known: false };
      if (!model) {
        return { win: null, src: 'Claude-Modell im UI nicht erkannt; Kontextfenster unbekannt', known: false };
      }
      if (!plan || plan.id === 'unknown') {
        return { win: null, src: 'Tarif unbekannt; Kontextfenster nicht zugeordnet', known: false };
      }
      if (!plan.paid) {
        return { win: null, src: 'Claude Help Center dokumentiert hier nur bezahlte Chat-Tarife; Free-Fenster unbekannt', known: false };
      }
      return { win: null, src: 'Modell-Kontextfenster nicht verifiziert', known: false };
    }

    if (Number.isFinite(calibratedWindow) && calibratedWindow > 0) {
      return { win: Math.round(calibratedWindow), src: 'Aus Kalibrierung gelernt', known: false };
    }
    if (manual) return { win: manual, src: 'Fallback aus den Einstellungen', known: false };
    return {
      win: Number(plan && plan.contextWindow) || Number(defaultContextWindow) || 200000,
      src: model ? 'Modell erkannt, Kontextfenster nicht verifiziert; Schätzwert' : 'Modell nicht erkannt; Standard-Schätzwert',
      known: false
    };
  }

  function budgetCalibrationKey(providerId, planId, windowId) {
    return providerId === 'claude' ? `${planId}:${windowId}` : windowId;
  }

  return {
    create,
    estimateTokens,
    messageKey,
    estimateMessageParts,
    estimateTextAttachment,
    countPdfPages,
    estimateImageTokens,
    sumAttachments,
    excludeContained,
    partitionStreamingMessage,
    estimatedUtilization,
    utilization,
    resolveContextWindow,
    budgetCalibrationKey
  };
});
