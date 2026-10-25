const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contextModel = require('../context-model.js');

const planWindow = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'plans.js'), 'utf8'),
  { window: planWindow }
);
const claudeConfig = planWindow.TX_CONFIG.providers.find((provider) => provider.id === 'claude');

function resolveClaudeWindow(label, planId, overrides = {}) {
  const plan = claudeConfig.plans.find((item) => item.id === planId);
  return contextModel.resolveContextWindow({
    providerId: 'claude',
    settings: {},
    plan,
    model: label ? { label, fullLabel: label, id: label.toLowerCase() } : null,
    models: claudeConfig.models,
    modelScan: claudeConfig.modelScan,
    defaultContextWindow: claudeConfig.defaultContextWindow,
    otherModelContextWindow: claudeConfig.otherModelContextWindow,
    ...overrides
  });
}

test('Claude paid chat model patterns resolve to the official plan-specific windows', () => {
  const cases = [
    ['Claude Fable 5.1', 1000000],
    ['Claude Fable 5', 500000],
    ['Claude Opus 5.5', 1000000],
    ['Claude Opus 5', 1000000],
    ['Claude Opus 4.8', 500000],
    ['Claude Opus 4.7', 500000],
    ['Claude Opus 4.6', 500000],
    ['Claude Sonnet 5.5', 1000000],
    ['Claude Sonnet 5', 1000000],
    ['Claude Sonnet 4.6', 500000],
    ['Claude Haiku 5.5', 1000000]
  ];
  for (const [model, expected] of cases) {
    for (const plan of ['pro', 'max5', 'max20']) {
      const result = resolveClaudeWindow(model, plan);
      assert.equal(result.win, expected, `${model} on ${plan}`);
      assert.equal(result.known, true);
      assert.match(result.src, /Claude Help Center/);
    }
  }
});

test('specific Claude versions are not accidentally matched as another version', () => {
  assert.equal(resolveClaudeWindow('Claude Fable 5.1', 'pro').win, 1000000);
  assert.equal(resolveClaudeWindow('Claude Fable 5.2', 'pro').win, 200000);
  assert.equal(resolveClaudeWindow('Claude Opus 5.5', 'pro').win, 1000000);
  assert.equal(resolveClaudeWindow('Claude Opus 5.6', 'pro').win, 200000);
  assert.equal(resolveClaudeWindow('Claude Sonnet 4.5', 'pro').win, 200000);
});

test('Claude Free and unknown tariffs do not inherit paid-plan context windows', () => {
  assert.equal(resolveClaudeWindow('Claude Opus 5.5', 'free').win, null);
  assert.match(resolveClaudeWindow('Claude Opus 5.5', 'free').src, /Free-Fenster unbekannt/);
  assert.equal(resolveClaudeWindow('Claude Opus 5.5', 'unknown').win, null);
  assert.equal(claudeConfig.defaultPlan, 'unknown');
});

test('missing or unrecognized Claude model labels do not use a context-window fallback', () => {
  assert.equal(resolveClaudeWindow(null, 'pro').win, null);
  assert.equal(resolveClaudeWindow('Unrecognized Model X', 'pro').win, null);
  assert.equal(resolveClaudeWindow('Claude Mythos 5', 'pro').win, 200000);
});

test('manual Claude limits remain available and invalid limits are ignored', () => {
  const manual = resolveClaudeWindow('Unrecognized Model X', 'free', {
    settings: { windowMode: 'manual', contextWindow: 321000 }
  });
  assert.equal(manual.win, 321000);
  assert.equal(manual.known, true);
  assert.equal(
    resolveClaudeWindow(null, 'pro', {
      settings: { windowMode: 'manual', contextWindow: -1 },
      calibratedWindow: 123000
    }).win,
    null
  );
  assert.equal(
    resolveClaudeWindow('Claude Opus 5.5', 'pro', {
      settings: { contextWindow: 321000 },
      calibratedWindow: 123000
    }).win,
    1000000
  );
});

test('Claude plan changes use separate usage calibration keys without changing other providers', () => {
  assert.notEqual(
    contextModel.budgetCalibrationKey('claude', 'pro', 'session'),
    contextModel.budgetCalibrationKey('claude', 'max5', 'session')
  );
  assert.equal(contextModel.budgetCalibrationKey('chatgpt', 'plus', 'session'), 'session');
  const chatgpt = contextModel.resolveContextWindow({
    providerId: 'chatgpt',
    settings: {},
    plan: { id: 'plus', contextWindow: 54000 },
    model: null,
    models: [],
    defaultContextWindow: 128000
  });
  assert.equal(chatgpt.win, 54000);
});

test('new chat has an empty transcript and unknown active context', () => {
  const context = contextModel.create({ transcriptEstimate: 0, contextWindow: 200000 });
  assert.equal(context.transcriptEstimate, 0);
  assert.equal(context.activeContextEstimate, null);
  assert.equal(contextModel.utilization(context), null);
});

test('a long transcript is not reported as active context', () => {
  const context = contextModel.create({ transcriptEstimate: 180000, contextWindow: 200000 });
  assert.equal(context.transcriptEstimate, 180000);
  assert.equal(context.activeContextEstimate, null);
  assert.equal(contextModel.utilization(context), null);
});

test('switching chats uses independent transcript estimates', () => {
  const firstChat = contextModel.create({ transcriptEstimate: 12000, contextWindow: 200000 });
  const secondChat = contextModel.create({ transcriptEstimate: 500, contextWindow: 200000 });
  assert.notEqual(firstChat.transcriptEstimate, secondChat.transcriptEstimate);
  assert.equal(firstChat.activeContextEstimate, null);
  assert.equal(secondChat.activeContextEstimate, null);
});

test('a duplicate render with no new transcript data does not change the estimate', () => {
  const firstRender = contextModel.create({ transcriptEstimate: 3200, contextWindow: 200000 });
  const duplicateRender = contextModel.create({ transcriptEstimate: 3200, contextWindow: 200000 });
  assert.deepEqual(duplicateRender, firstRender);
});

test('a re-rendered identical message keeps its full-content identity', () => {
  const text = 'Repeated prefix '.repeat(10);
  assert.equal(contextModel.messageKey('u', text), contextModel.messageKey('u', text));
  assert.notEqual(
    contextModel.messageKey('u', text + 'first ending'),
    contextModel.messageKey('u', text + 'different ending')
  );
});

test('late-loaded transcript data changes only the transcript estimate', () => {
  const beforeLoad = contextModel.create({ transcriptEstimate: 2000, contextWindow: 200000 });
  const afterLoad = contextModel.create({ transcriptEstimate: 9000, contextWindow: 200000 });
  assert.equal(afterLoad.transcriptEstimate, 9000);
  assert.equal(afterLoad.activeContextEstimate, beforeLoad.activeContextEstimate);
  assert.equal(contextModel.utilization(afterLoad), null);
});

test('an unverified compaction signal cannot invent an active-context estimate', () => {
  const context = contextModel.create({
    transcriptEstimate: 85000,
    activeContextEstimate: null,
    contextWindow: 200000
  });
  assert.equal(context.activeContextEstimate, null);
  assert.equal(contextModel.utilization(context), null);
});

test('a separately verified active-context value can produce utilization', () => {
  const context = contextModel.create({
    transcriptEstimate: 180000,
    activeContextEstimate: 50000,
    contextWindow: 200000
  });
  assert.equal(context.transcriptEstimate, 180000);
  assert.equal(contextModel.utilization(context), 0.25);
});

test('unknown transcript or window data stays unknown', () => {
  const context = contextModel.create({ transcriptEstimate: NaN, contextWindow: null });
  assert.equal(context.transcriptEstimate, null);
  assert.equal(context.contextWindow, null);
  assert.equal(contextModel.utilization(context), null);
});

test('model changes and reloads do not turn transcript history into active context', () => {
  const beforeModelChange = contextModel.create({ transcriptEstimate: 42000, contextWindow: 200000 });
  const afterModelChange = contextModel.create({ transcriptEstimate: 42000, contextWindow: 1000000 });
  const afterReload = contextModel.create({ transcriptEstimate: 42000, contextWindow: 1000000 });
  assert.notEqual(beforeModelChange.contextWindow, afterModelChange.contextWindow);
  assert.equal(afterModelChange.activeContextEstimate, null);
  assert.equal(afterReload.activeContextEstimate, null);
  assert.equal(contextModel.utilization(afterReload), null);
});

const estimator = {
  englishCharsPerToken: 4,
  germanCharsPerToken: 3.2,
  codeCharsPerToken: 3,
  messageOverhead: 4,
  imageTokens(provider, width, height) {
    return provider === 'claude' ? null : Math.ceil((width * height) / 750);
  }
};

test('short and long text estimates are finite and monotonic, not reference token counts', () => {
  const short = contextModel.estimateTokens('Short sentence.', false, estimator);
  const long = contextModel.estimateTokens('A longer sentence. '.repeat(500), false, estimator);
  assert.ok(Number.isFinite(short) && short > 0);
  assert.ok(long > short);
});

test('English, German, and mixed-language text produce usable heuristics', () => {
  for (const text of [
    'The quick brown fox jumps over the lazy dog.',
    'Der schnelle Fuchs springt über den faulen Hund.',
    'The quick fox springt über den lazy dog.'
  ]) {
    assert.ok(contextModel.estimateTokens(text, false, estimator) > 0);
  }
});

test('code and structured JSON use the code heuristic', () => {
  const source = 'const value = {"items":[1,2,3]};';
  const proseEstimate = contextModel.estimateTokens(source, false, estimator);
  const codeEstimate = contextModel.estimateTokens(source, true, estimator);
  assert.ok(codeEstimate >= proseEstimate);
  const json = '{"items":[1,2,3]}';
  assert.equal(
    contextModel.estimateTokens(json, false, estimator),
    contextModel.estimateTokens(json, true, estimator)
  );
});

test('emoji sequences and Unicode text produce finite estimates', () => {
  for (const text of ['🙂', '👨‍👩‍👧‍👦', '日本語の文章', 'e\u0301']) {
    assert.ok(Number.isFinite(contextModel.estimateTokens(text, false, estimator)));
    assert.ok(contextModel.estimateTokens(text, false, estimator) > 0);
  }
});

test('message prose and code blocks are separate simulated components', () => {
  const result = contextModel.estimateMessageParts(
    'A message outside the block.',
    ['const x = 1;', '{"key": "value"}'],
    estimator,
    estimator.messageOverhead
  );
  assert.ok(result.prose > 0);
  assert.ok(result.code > 0);
  assert.equal(
    result.prose,
    contextModel.estimateTokens('A message outside the block.', false, estimator) + 4
  );
});

test('text attachments report approximate and truncated status', () => {
  const complete = contextModel.estimateTextAttachment('const x = 1;', true, estimator, 100);
  const truncated = contextModel.estimateTextAttachment('123456789', false, estimator, 4);
  assert.equal(complete.approx, true);
  assert.equal(complete.truncated, false);
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.tokens > 0);
});

test('simulated PDF page markers are counted; unparseable PDFs stay unknown', () => {
  const samplePdf = '%PDF-1.4 /Type /Pages /Type /Page /Type /Page';
  assert.equal(contextModel.countPdfPages(samplePdf), 2);
  assert.equal(contextModel.countPdfPages('%PDF-1.4 no page tree'), null);
});

test('invalid image metadata and unsupported attachments stay unknown', () => {
  assert.equal(
    contextModel.estimateImageTokens('claude', -1, 100, estimator.imageTokens),
    null
  );
  assert.equal(contextModel.estimateImageTokens('claude', 100, 100, estimator.imageTokens), null);
  assert.equal(
    contextModel.estimateImageTokens('gemini', 100, 100, estimator.imageTokens),
    14
  );
  assert.deepEqual(contextModel.sumAttachments([{ tokens: null }, { tokens: NaN }]), {
    tokens: 0,
    unknownCount: 2,
    approximateCount: 0
  });
  assert.equal(contextModel.estimatedUtilization(1000, 2000, 1), null);
});

test('artifact nested in a message is excluded from separate simulated counting', () => {
  const message = { contains: (node) => node === 'nested-artifact' };
  const artifact = 'nested-artifact';
  const separateArtifact = 'separate-artifact';
  assert.deepEqual(
    contextModel.excludeContained([artifact, separateArtifact], [message]),
    [separateArtifact]
  );
});

test('streaming and re-rendered simulated messages do not change unchanged estimates', () => {
  const streamed = 'A response that is still arriving.';
  const firstRender = contextModel.estimateTokens(streamed, false, estimator);
  const repeatedRender = contextModel.estimateTokens(streamed, false, estimator);
  const completedRender = contextModel.estimateTokens(streamed, false, estimator);
  assert.equal(repeatedRender, firstRender);
  assert.equal(completedRender, firstRender);
});

test('streaming assistant output stays live until settling in a simulated message list', () => {
  const user = { role: 'user' };
  const previousAssistant = { role: 'assistant', id: 'previous' };
  const liveAssistant = { role: 'assistant', id: 'live' };
  const messages = [user, previousAssistant, liveAssistant];
  const isUser = (message) => message.role === 'user';
  const streaming = contextModel.partitionStreamingMessage(messages, true, isUser);
  assert.deepEqual(streaming.stored, [user, previousAssistant]);
  assert.equal(streaming.live, liveAssistant);
  const settled = contextModel.partitionStreamingMessage(messages, false, isUser);
  assert.deepEqual(settled.stored, messages);
  assert.equal(settled.live, null);
});

test('missing and empty content does not produce a fabricated token estimate', () => {
  assert.equal(contextModel.estimateTokens('', false, estimator), 0);
  assert.equal(contextModel.estimateTokens(null, false, estimator), 0);
  assert.equal(contextModel.countPdfPages(null), null);
});
