// Explicit artifact acceptance, isolated from the running Host and its data.
// Usage: node scripts/check-issue-workbench-artifact.mjs /absolute/candidate.tgz
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parse } from 'yaml';
import { ModulePluginRuntime } from '../dist/domains/plugin/builtin-runtime/carriers/module-plugin-runtime.js';
import { withPluginCallContext } from '../dist/domains/plugin/carrier/plugin-call-context.js';
import { FilesystemVerifiedPluginPackageLocator } from '../dist/domains/plugin/external-runtime/filesystem-package-locator.js';
import { FilePluginInventoryStore, HostInventoryControlPlane } from '../dist/domains/plugin/host-inventory/index.js';
import { LocalPluginPackageAdmission } from '../dist/domains/plugin/manager/local-package-admission.js';
import { resolveLocalPluginEffectiveGrants } from '../dist/domains/plugin/manager/machine-catalog-provider.js';
import { OFFICIAL_PLUGIN_HOST_POLICIES } from '../dist/domains/plugin/manager/official-plugin-host-policies.js';

const archive = process.argv[2];
if (!archive || !isAbsolute(archive)) throw new Error('Supply the exact absolute candidate archive path');
const root = await mkdtemp(join(tmpdir(), 'issue-workbench-host-acceptance-'));
let runtime;
let instanceId;
try {
  const original = await readFile(archive);
  const unpacked = join(root, 'unpacked');
  await mkdir(unpacked);
  execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
  const manifest = parse(await readFile(join(unpacked, 'package/plugin.candidate.yaml'), 'utf8'));
  assert.equal(manifest.pluginId, 'dev.clowder.issue-workbench');
  // A prepared candidate differs from the published tarball solely by this Host manifest.
  // Keep both digests; do not represent this as catalog publication or operator installation.
  await writeFile(join(unpacked, 'package/manifest.json'), `${JSON.stringify(manifest)}\n`);
  const prepared = join(root, 'prepared.tgz');
  execFileSync('tar', ['-czf', prepared, '-C', unpacked, 'package']);
  const inventoryFile = join(root, 'inventory.json');
  const store = new FilePluginInventoryStore(inventoryFile);
  const inventory = new HostInventoryControlPlane(store);
  const packagesRoot = join(root, 'packages');
  const admission = new LocalPluginPackageAdmission({
    inventory,
    packagesRoot,
    grantPolicy: (value) => resolveLocalPluginEffectiveGrants(OFFICIAL_PLUGIN_HOST_POLICIES, value),
  });
  const admitted = await admission.install({ kind: 'local-archive', path: prepared });
  instanceId = admitted.pluginInstanceId;
  const restored = await new FilePluginInventoryStore(inventoryFile).snapshot();
  const record = restored.packages.find((value) => value.packageDigest === admitted.packageDigest);
  const grants = restored.grants.find((value) => value.pluginInstanceId === instanceId).effectiveGrants;
  assert.ok(grants.includes('messaging.send'));
  assert.ok(grants.includes('thread.readContent'));
  assert.equal(restored.instances.length, 1);
  const config = new Map();
  runtime = new ModulePluginRuntime({
    packages: new FilesystemVerifiedPluginPackageLocator(packagesRoot),
    dataDirectoryParent: join(root, 'data'),
    configuration: { readConfig: async (_id, key) => config.get(key), readSecret: async () => undefined },
    log() {},
  });
  assert.equal(runtime.claims(record), true);
  await runtime.start(instanceId, record, grants);
  await assert.rejects(
    runtime.invoke(instanceId, 'issue.team.inspect', { repo: 'zts212653/clowder-ai', number: 1628 }),
    /Host caller/,
  );
  // Real Host invocation carrier; source identity is an explicit acceptance fixture,
  // not a claim that a live cat or owner conversation has used the installed tool.
  const caller = {
    catId: 'acceptance-cat',
    threadId: 'acceptance-thread',
    userId: 'acceptance-owner',
    invocationId: 'acceptance-invocation',
    source: { kind: 'primary', sourceMessageId: 'acceptance-source' },
    ownerAuthProvenance: 'strict',
    assertCurrent: async () => {},
  };
  config.set('repositories', 'zts212653/clowder-ai');
  const invoke = (method, input) =>
    withPluginCallContext(instanceId, caller, () => runtime.invoke(instanceId, method, input));
  const result = await invoke('issue.team.inspect', { repo: 'zts212653/clowder-ai', number: 1628 });
  assert.equal(result.data.repo, 'zts212653/clowder-ai');
  assert.equal(result.data.number, 1628);
  assert.ok(result.data.title);
  await assert.rejects(invoke('issue.team.inspect', { repo: 'example/unauthorized', number: 1 }), /not enabled/);
  await runtime.stop(instanceId, 'acceptance-disable');
  await assert.rejects(invoke('issue.team.inspect', { repo: 'zts212653/clowder-ai', number: 1628 }), {
    code: 'INSTANCE_NOT_RUNNABLE',
  });
  await runtime.start(instanceId, record, grants);
  const again = await invoke('issue.team.inspect', { repo: 'zts212653/clowder-ai', number: 1628 });
  assert.equal(again.data.id, result.data.id);
  await runtime.stop(instanceId, 'acceptance-complete');
  runtime = undefined;
  console.log(
    JSON.stringify(
      {
        result: 'passed',
        scope: 'isolated-real-host-admission-module-read-disable-reenable',
        originalSha256: createHash('sha256').update(original).digest('hex'),
        preparedSha256: createHash('sha256')
          .update(await readFile(prepared))
          .digest('hex'),
        packageDigest: admitted.packageDigest,
        pluginId: manifest.pluginId,
        grants,
        issue: { repo: result.data.repo, number: result.data.number, title: result.data.title },
        remoteWrites: 0,
        liveCatInvocation: false,
        operatorInstallation: false,
      },
      null,
      2,
    ),
  );
} finally {
  if (runtime && instanceId) await runtime.stop(instanceId, 'acceptance-finally');
  await rm(root, { recursive: true, force: true });
}
