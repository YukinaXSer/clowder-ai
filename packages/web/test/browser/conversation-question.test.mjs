import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from '../../../api/node_modules/fastify/fastify.js';
import { detectChromePath } from '../../../api/src/services/image-export-browser-session.ts';

const puppeteer = createRequire(new URL('../../../api/package.json', import.meta.url))('puppeteer-core');

import { MessageStore } from '../../../api/src/domains/cats/services/stores/ports/MessageStore.ts';
import { ConversationQuestionStartGuard } from '../../../api/src/domains/runtime-interaction/ConversationQuestionStartGuard.ts';
import {
  createConversationQuestionService,
  withdrawQuestionContinuations,
} from '../../../api/src/domains/runtime-interaction/conversation-question-composition.ts';
import { MessageRuntimeInteractionCardPublisher } from '../../../api/src/domains/runtime-interaction/RuntimeInteractionCardPublisher.ts';
import { RuntimeInteractionService } from '../../../api/src/domains/runtime-interaction/RuntimeInteractionService.ts';
import { InMemoryRuntimeInteractionStore } from '../../../api/src/domains/runtime-interaction/stores/InMemoryRuntimeInteractionStore.ts';
import { conversationQuestionRoutes } from '../../../api/src/routes/conversation-question-routes.ts';
import { runtimeInteractionRoutes } from '../../../api/src/routes/runtime-interaction-routes.ts';
import { createPersistedQueueFixture } from '../../../api/test/helpers/persisted-queue-fixture.ts';
import { createNextDevTestEnvironment } from './next-dev-test-environment.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = '/dev/conversation-question';
const cat = {
  id: 'codex-sol',
  displayName: '砚砚',
  variantLabel: 'Codex',
  color: { primary: '#6b8f34', secondary: '#c8d8b5' },
  mentionPatterns: ['codex-sol'],
  clientId: 'openai',
  defaultModel: 'gpt-6-astra',
  avatar: '/avatars/codex.png',
  roleDescription: '共创伙伴',
  personality: 'warm',
  roster: { family: 'maine-coon', roles: [], lead: false, available: true, evaluation: 'fixture' },
};
const thread = {
  id: 'question-browser',
  title: '报告交付讨论',
  projectPath: '/fixture/interactive-decisions',
  createdBy: 'default-user',
  participants: ['codex-sol'],
  lastActiveAt: 1791876293513,
  createdAt: 1791876293513,
};

test(
  'in the real chat: focus-local keyboard → durable answer → original work starts; refresh, edit, defer and cancel',
  { timeout: 180000 },
  async () => {
    const messages = new MessageStore();
    const store = new InMemoryRuntimeInteractionStore();
    const socket = { broadcastToRoom() {}, emitToUser() {} };
    const queue = createPersistedQueueFixture(messages, undefined, {
      conversationQuestionStartGuard: new ConversationQuestionStartGuard({ store, messages }),
    });
    const errors = [];
    const service = createConversationQuestionService({
      store,
      messages,
      delivery: queue.delivery,
      socket,
      cancelQueued: (record) => withdrawQuestionContinuations(record, queue.queue, queue.coordinator),
      onError: (error) => errors.push(error),
    });
    const app = Fastify();
    await app.register(conversationQuestionRoutes, { service });
    await app.register(runtimeInteractionRoutes, {
      service: new RuntimeInteractionService({
        store,
        hostEpoch: 'fixture',
        cardPublisher: new MessageRuntimeInteractionCardPublisher({ messageStore: messages, socketManager: socket }),
      }),
    });
    const ask = (suffix) =>
      service.ask({
        owner: { userId: 'default-user', threadId: thread.id, catId: cat.id, invocationId: `original-${suffix}` },
        subjectRef: `report:${suffix}`,
        title: suffix === 'format' ? '这份报告以什么格式交付？' : '下一份报告的格式',
        questions: [
          {
            id: 'format',
            header: '交付格式',
            question: '你更希望直接阅读，还是继续编辑？',
            isOther: true,
            options: [
              { label: 'PDF', description: '排版固定，方便阅读与分享。' },
              { label: 'Markdown', description: '便于继续修改内容。' },
            ],
          },
        ],
        continuations: [
          {
            catId: cat.id,
            workRef: `report:${suffix}:write`,
            work: '完成报告的最终交付',
            afterAnswer: '继续完成原报告，使用选择的格式',
          },
        ],
      });
    await ask('format');
    let browser, server, nextDev, page;
    const clientErrors = [];
    const output = [];
    try {
      const probe = createServer();
      probe.listen(0, '127.0.0.1');
      await once(probe, 'listening');
      const port = probe.address().port;
      probe.close();
      await once(probe, 'close');
      const base = `http://127.0.0.1:${port}`;
      execFileSync(process.execPath, ['scripts/sync-vendor-assets.mjs'], { cwd: WEB_ROOT });
      nextDev = await createNextDevTestEnvironment('conversation-question', { NEXT_PUBLIC_API_URL: base });
      server = spawn(
        process.execPath,
        [path.resolve(WEB_ROOT, '../../node_modules/next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(port)],
        { cwd: WEB_ROOT, env: nextDev.env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      server.stdout.on('data', (data) => output.push(String(data)));
      server.stderr.on('data', (data) => output.push(String(data)));
      const deadline = Date.now() + 120000;
      while (true) {
        if (server.exitCode !== null || Date.now() > deadline) throw new Error(output.join('').slice(-8000));
        try {
          if ((await fetch(`${base}${fixturePath}`)).ok) break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      browser = await puppeteer.launch({ headless: true, executablePath: detectChromePath() });
      page = await browser.newPage();
      page.setDefaultTimeout(10000);
      await page.setViewport({ width: 1280, height: 900 });
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('cat-cafe:shell-presentation', 'v2');
        localStorage.setItem('cat-cafe-userId', 'default-user');
      });
      page.on('pageerror', (error) => clientErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') output.push(message.text());
      });
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return request.continue();
        if (url.pathname.startsWith('/api/runtime-interactions/')) {
          const response = await app.inject({
            method: request.method(),
            url: url.pathname,
            headers: { 'x-cat-cafe-user': 'default-user', 'content-type': 'application/json' },
            ...(request.postData() ? { payload: request.postData() } : {}),
          });
          return request.respond({ status: response.statusCode, contentType: 'application/json', body: response.body });
        }
        let body = {};
        if (url.pathname === '/api/dev/conversation-question')
          body = {
            thread,
            messages: messages
              .getByThread(thread.id)
              .map((message) => ({ ...message, type: message.catId ? 'assistant' : 'user' })),
          };
        else if (url.pathname === '/api/debug/callback-auth')
          body = {
            reasonCounts: {},
            toolCounts: {},
            byCat: {},
            recentSamples: [],
            totalFailures: 0,
            startedAt: Date.now(),
            uptimeMs: 0,
            recent24h: { totalFailures: 0, byReason: {}, byTool: {}, byCat: {} },
          };
        else if (url.pathname === '/api/agent-hooks/status') body = { status: 'configured', targets: [] };
        else if (url.pathname === '/api/config/conversation-view')
          body = { stored: null, effective: { mode: 'group' }, source: 'product' };
        else if (url.pathname === '/api/cats') body = { cats: [cat] };
        else if (url.pathname === '/api/config/cat-order') body = { catOrder: [cat.id] };
        else if (url.pathname === '/api/threads') body = { threads: [thread] };
        else if (url.pathname.endsWith('/queue')) body = { queue: [], paused: false, activeInvocations: [] };
        else if (url.pathname.endsWith('/task-progress')) body = { taskProgress: {} };
        else if (url.pathname.startsWith('/api/threads/')) body = thread;
        else if (url.pathname === '/api/tasks') body = { tasks: [] };
        else if (url.pathname === '/api/bootcamp/threads') body = { threads: [] };
        else if (url.pathname === '/api/session') body = { ok: true };
        else if (url.pathname === '/api/health' || url.pathname === '/api/ready') body = { status: 'ok' };
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const selector = '[data-testid="conversation-question"]';
      const waitText = (text) => page.waitForFunction((text) => document.body.innerText.includes(text), {}, text);
      const textOfCard = (index = 0) => page.$$eval(selector, (cards, i) => cards[i]?.textContent, index);
      async function clickButton(text, index = 0) {
        await page.waitForFunction(
          (selector, text, index) =>
            [...(document.querySelectorAll(selector)[index]?.querySelectorAll('button') ?? [])].some(
              (button) => button.textContent.trim() === text && !button.disabled,
            ),
          {},
          selector,
          text,
          index,
        );
        const handle = await page.evaluateHandle(
          (selector, text, index) =>
            [...document.querySelectorAll(selector)[index].querySelectorAll('button')].find(
              (button) => button.textContent.trim() === text,
            ),
          selector,
          text,
          index,
        );
        const element = handle.asElement();
        assert.ok(element, `button ${text} must exist`);
        await element.click();
        await handle.dispose();
      }
      await page.goto(`${base}${fixturePath}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(selector);
      assert.equal(queue.starts.length, 0);
      await page.waitForSelector('textarea');
      await page.type('textarea', '先保留我的草稿');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.$eval('textarea', (element) => element.value), '先保留我的草稿');
      await clickButton('暂不决定');
      await waitText('暂不决定 · 问题已保留');
      assert.equal(queue.starts.length, 0);
      await page.reload();
      await page.waitForSelector(selector);
      await waitText('暂不决定 · 问题已保留');
      const options = await page.$$(`${selector} [role="radio"]`);
      await options[0].focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await options[1].evaluate((element) => element.getAttribute('aria-checked')), 'true');
      await page.keyboard.press('Enter');
      await waitText('修改回答');
      const answered = await store.get((await ask('format')).request.interactionId);
      await queue.waitForAwakening(answered.conversation.continuations[0].messageId);
      assert.equal(queue.starts.length, 1);
      assert.match(queue.prompts[0], /Markdown/);
      await page.reload();
      await waitText('修改回答');
      assert.match(await textOfCard(), /交付格式：Markdown/);
      await clickButton('修改回答');
      await page.type(`${selector} input`, '都不是，请给我可编辑的 HTML');
      await clickButton('提交回答');
      await waitText('第 2 版');
      assert.equal(queue.starts.length, 1, 'editing must not duplicate the running original step');
      const shots = path.resolve(WEB_ROOT, '../../.cat-cafe/test-evidence/interactive-decisions');
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: path.join(shots, 'desktop-answer.png'), fullPage: true });
      await ask('cancel');
      await page.reload();
      await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 2, {}, selector);
      await page.setViewport({ width: 390, height: 844 });
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForSelector('[aria-hidden="true"].backdrop-blur-sm');
      await page.mouse.click(370, 400);
      await page.waitForFunction(() => !document.querySelector('[aria-hidden="true"].backdrop-blur-sm'));
      await page.screenshot({ path: path.join(shots, 'mobile-before-cancel.png'), fullPage: true });
      await clickButton('取消这项工作', 1);
      await clickButton('确认取消这项工作', 1);
      await waitText('这项待答工作已取消');
      assert.equal(queue.starts.length, 1);
      await page.screenshot({ path: path.join(shots, 'mobile-cancel.png'), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      assert.deepEqual(errors, []);
      assert.deepEqual(clientErrors, []);
    } catch (error) {
      await page?.screenshot({ path: '/tmp/cat-cafe-question-failure.png', fullPage: true });
      console.error(
        JSON.stringify({
          clientErrors,
          body: await page?.evaluate(() => document.body.innerText).catch(() => ''),
          server: output.join('').slice(-4000),
        }),
      );
      throw error;
    } finally {
      await browser?.close();
      if (server?.exitCode === null) {
        server.kill('SIGTERM');
        await once(server, 'exit');
      }
      await nextDev?.cleanup();
      await queue.close();
      await app.close();
    }
  },
);
