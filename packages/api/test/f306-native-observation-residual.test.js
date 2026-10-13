import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decideNativeHookPayload } from '../../../scripts/native-effect-target-guard.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'f306-observation-residual-')));
const main = join(root, 'cat-cafe');
const runtime = join(root, 'cat-cafe-runtime');
const ordinary = join(root, 'ordinary');
const guardedBin = join(runtime, 'scripts', 'guarded-bin');
mkdirSync(main);
mkdirSync(ordinary);
mkdirSync(guardedBin, { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));
const noHost = { selfHost: () => ({ confidence: 'none' }) };
const publicGuard = fileURLToPath(new URL('../scripts/public-test-external-resource-guard.mjs', import.meta.url));

function classifyCleanLoaderFixture(payload) {
  const inheritedOptions = process.env.NODE_OPTIONS;
  // Model a clean loader for this synchronous, non-executing classifier call.
  // Ignore only the exact public harness preload; hostile loader fixtures remain
  // inputs. Installed network guards stay active, and every spawn inherits the
  // original preload restored in finally.
  if (inheritedOptions === `--import=${publicGuard}`) delete process.env.NODE_OPTIONS;
  try {
    return decideNativeHookPayload(payload, noHost);
  } finally {
    if (inheritedOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = inheritedOptions;
  }
}
function parity(command, decision, cwd = main) {
  const results = [];
  for (const tool_name of ['Bash', 'exec_command']) {
    const result = classifyCleanLoaderFixture({
      tool_name,
      cwd,
      tool_input: { command, cmd: command },
      ...(tool_name === 'exec_command' ? { turn_id: 'owned-observation-turn' } : {}),
    });
    assert.equal(result.decision, decision, `${tool_name}: ${command}: ${JSON.stringify(result)}`);
    results.push(result);
  }
  return results;
}

// Boot22 source077: diff/find/du was rejected, then split into separate probes.
test('recursive comparison and its compound read stay read-only across protected sources', () => {
  const compare = `diff -qr ${runtime} ${ordinary}`;
  parity(compare, 'allow');
  parity(`/usr/bin/${compare}`, 'allow', runtime);
  parity(`${compare} && find ${runtime} -type f && du -sk ${runtime} ${ordinary}`, 'allow');
  parity(`diff --brief --recursive -- ${runtime} ${ordinary}`, 'allow');
  parity(`diff -u ${runtime}/package.json ${ordinary}/package.json`, 'allow');
});

test('sequential comparison retains program proof around a separate read pipeline', async (t) => {
  const compare = `diff -qr ${runtime} ${ordinary}`;
  const count = `find ${runtime} -type f | wc -l`;
  for (const cwd of [main, runtime]) {
    for (const command of [
      `${compare} && ${count} && du -sk ${runtime} ${ordinary}`,
      `${compare}; ${count}`,
      `${compare} && printf '{ {' | wc -l`,
    ])
      await t.test(`read: ${cwd}: ${command}`, () => {
        for (const result of parity(command, 'allow', cwd)) assert.equal(result.effect, 'read');
      });
    for (const command of [
      `${compare} | wc -l`,
      `( ${compare} ) | wc -l`,
      `{ ${compare}; } | wc -l`,
      `{ { ${compare}; }; } | wc -l`,
      `{ { { ${compare}; }; }; } | wc -l`,
      `! { ${compare}; } | wc -l`,
      `if test x = x; then ${compare}; fi | wc -l`,
      `${compare} && { ${count}; }`,
      // Existing delegated find evidence does not attest later program identity.
      `${count} && ${compare}`,
      `${compare} & ${count}; wait`,
      `${compare} && cat <(printf data)`,
      `export PATH=${guardedBin}:/usr/bin:/bin; ${count} && ${compare}`,
      `${compare} && ${count} && touch ${runtime}/forbidden`,
      `${compare} && { ln -s ${runtime} ${ordinary}/alias; } | wc -l && cp -- ${runtime}/package.json ${ordinary}/alias/copied.json`,
    ])
      await t.test(`deny: ${cwd}: ${command}`, () => parity(command, 'deny', cwd));
  }
});

test('comparison cannot erase unknown options, output writes or executable segments', () => {
  parity(`diff --output=${runtime}/output ${ordinary}/a ${ordinary}/b`, 'deny');
  parity(`diff --unknown ${runtime} ${ordinary}`, 'deny');
  parity(`diff -qr ${runtime} ${ordinary} > ${runtime}/output`, 'deny');
  parity(`diff -qr ${runtime} ${ordinary} && touch ${runtime}/output`, 'deny');
  parity(`diff -qr ${runtime} ${ordinary} && find ${runtime} -exec rm -rf ${runtime} ';'`, 'deny');
  parity(`${guardedBin}/diff -qr ${runtime} ${ordinary}`, 'deny');
});

test('comparison reads require the observed system program and unchanged earlier selection', () => {
  const savedPath = process.env.PATH;
  const savedTool = process.env.F306_OBSERVATION_TOOL;
  const savedSource = process.env.F306_OBSERVATION_SOURCE;
  writeFileSync(join(guardedBin, 'diff'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  try {
    process.env.PATH = `${guardedBin}:/usr/bin:/bin`;
    parity(`diff -qr ${runtime} ${ordinary}`, 'deny');
    process.env.F306_OBSERVATION_TOOL = 'diff';
    process.env.F306_OBSERVATION_SOURCE = runtime;
    parity(`"$F306_OBSERVATION_TOOL" -qr ${runtime} ${ordinary}`, 'deny');
    parity(`diff -qr "$F306_OBSERVATION_SOURCE" ${ordinary}`, 'deny');
    process.env.PATH = '/usr/bin:/bin';
    parity(`export PATH=${guardedBin}:/usr/bin:/bin; diff -qr ${runtime} ${ordinary}`, 'deny');
    parity(`export PATH=${guardedBin}:/usr/bin:/bin; /usr/bin/diff -qr ${runtime} ${ordinary}`, 'deny');
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedTool === undefined) delete process.env.F306_OBSERVATION_TOOL;
    else process.env.F306_OBSERVATION_TOOL = savedTool;
    if (savedSource === undefined) delete process.env.F306_OBSERVATION_SOURCE;
    else process.env.F306_OBSERVATION_SOURCE = savedSource;
  }
});

// Same exact repository wrapper and dependencies, using its mandated absolute spelling.
test('absolute pinned gh wrapper retains the PR/API read contract', () => {
  const gh = join(guardedBin, 'gh');
  const delegate = join(ordinary, 'gh');
  const wrapper = readFileSync(new URL('../../../scripts/guarded-bin/gh', import.meta.url));
  writeFileSync(gh, wrapper, { mode: 0o700 });
  writeFileSync(delegate, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const savedPath = process.env.PATH;
  const savedDelegate = process.env.CAT_CAFE_REAL_GH_PATH;
  process.env.PATH = `${guardedBin}:${dirname(process.execPath)}:${ordinary}:/usr/bin:/bin`;
  process.env.CAT_CAFE_REAL_GH_PATH = delegate;
  try {
    parity(`${gh} pr view 5346 --repo zts212653/cat-cafe --json state,mergeCommit,headRefOid`, 'allow');
    parity(`${gh} pr checks 5346 --repo zts212653/cat-cafe --json name,state`, 'allow');
    parity(`${gh} pr list --repo zts212653/cat-cafe --state open --json number,files`, 'allow');
    parity(`${gh} api repos/zts212653/cat-cafe/pulls/5346 --method GET`, 'allow');
    parity(`NODE_OPTIONS='--require ${runtime}/loader.js' ${gh} pr view 5346`, 'deny');
    parity(`${gh} api repos/zts212653/cat-cafe/issues --method POST`, 'deny');
    parity(`${gh} pr view 5346 > ${runtime}/output`, 'deny');
    parity(`export NODE_OPTIONS='--require ${runtime}/loader.js'; ${gh} pr view 5346`, 'deny');
    parity(`export CAT_CAFE_REAL_GH_PATH=${runtime}/unreviewed-gh; ${gh} pr view 5346`, 'deny');
    parity(`export PATH=${guardedBin}:/usr/bin:/bin; ${gh} pr view 5346`, 'deny');
    const savedOptions = process.env.NODE_OPTIONS;
    try {
      process.env.NODE_OPTIONS = `--require ${runtime}/loader.js`;
      parity(`${gh} pr view 5346`, 'deny');
      parity('/usr/bin/gh pr view 5346', 'deny', runtime);
      const savedPull = process.env.F306_OBSERVATION_PULL;
      try {
        process.env.F306_OBSERVATION_PULL = '5346';
        parity('/usr/bin/gh pr view "$F306_OBSERVATION_PULL"', 'deny', runtime);
      } finally {
        if (savedPull === undefined) delete process.env.F306_OBSERVATION_PULL;
        else process.env.F306_OBSERVATION_PULL = savedPull;
      }
    } finally {
      if (savedOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = savedOptions;
    }
    writeFileSync(gh, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    parity(`${gh} pr view 5346`, 'deny');
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedDelegate === undefined) delete process.env.CAT_CAFE_REAL_GH_PATH;
    else process.env.CAT_CAFE_REAL_GH_PATH = savedDelegate;
  }
});

test('gh read proof distinguishes inherited lookup from inline selection in all cwd roles', async (t) => {
  const gh = join(guardedBin, 'gh');
  const delegate = join(ordinary, 'gh');
  const evilBin = join(ordinary, 'evilbin');
  mkdirSync(evilBin);
  writeFileSync(join(evilBin, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  writeFileSync(gh, readFileSync(new URL('../../../scripts/guarded-bin/gh', import.meta.url)), { mode: 0o700 });
  writeFileSync(delegate, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const savedPath = process.env.PATH;
  const savedDelegate = process.env.CAT_CAFE_REAL_GH_PATH;
  process.env.PATH = `${guardedBin}:${dirname(process.execPath)}:${ordinary}:/usr/bin:/bin`;
  process.env.CAT_CAFE_REAL_GH_PATH = delegate;
  const inline = [
    `PATH=${evilBin}:${process.env.PATH} ${gh} pr view 5346`,
    `CAT_CAFE_REAL_GH_PATH=${delegate} ${gh} pr view 5346`,
    `env PATH=${evilBin}:${process.env.PATH} ${gh} pr view 5346`,
    `env CAT_CAFE_REAL_GH_PATH=${delegate} ${gh} pr view 5346`,
    `env PATH=${evilBin}:${process.env.PATH} CAT_CAFE_REAL_GH_PATH=${delegate} ${gh} pr view 5346`,
  ];
  try {
    for (const [role, cwd] of [
      ['main', main],
      ['ordinary', ordinary],
      ['runtime', runtime],
    ]) {
      for (const [index, command] of inline.entries()) {
        await t.test(`${role}: inline selection ${index + 1} stays unproved`, () => {
          for (const result of parity(command, 'deny', cwd)) {
            assert.equal(result.effect, 'unknown', JSON.stringify(result));
            assert.equal(result.target.kind, 'runtime_sanctuary', JSON.stringify(result));
          }
        });
      }
      await t.test(`${role}: verified canonical query retains read and remote target`, () => {
        for (const result of parity(`${gh} pr view 5346`, 'allow', cwd)) {
          assert.equal(result.effect, 'read', JSON.stringify(result));
          assert.equal(result.target.kind, 'remote_repository', JSON.stringify(result));
        }
        for (const result of parity(`cd ${runtime} && ${gh} pr view 5346`, 'allow', cwd))
          assert.equal(result.effect, 'read');
      });
    }
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedDelegate === undefined) delete process.env.CAT_CAFE_REAL_GH_PATH;
    else process.env.CAT_CAFE_REAL_GH_PATH = savedDelegate;
  }
});

test('real shared hook keeps inherited loader selection unproved under public isolation', () => {
  const guard = fileURLToPath(new URL('../../../scripts/native-effect-target-guard.mjs', import.meta.url));
  for (const command of [`diff -qr ${runtime} ${ordinary}`, `diff -qr ${runtime} ${ordinary} > ${runtime}/output`]) {
    const result = spawnSync(process.execPath, [guard], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${publicGuard}`,
        CAT_CAFE_PUBLIC_TEST_RESOURCE_SCOPE: 'distributable',
      },
      input: JSON.stringify({ tool_name: 'Bash', cwd: runtime, tool_input: { command } }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  }
});
