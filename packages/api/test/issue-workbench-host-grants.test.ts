import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PluginManifest } from '@clowder-ai/plugin-contract';
import { HostInventoryControlPlane, MemoryPluginInventoryStore } from '../src/domains/plugin/host-inventory/index.js';
import { resolveLocalPluginEffectiveGrants } from '../src/domains/plugin/manager/machine-catalog-provider.js';
import { reconcileOfficialPluginGrants } from '../src/domains/plugin/manager/official-plugin-grants.js';
import { OFFICIAL_PLUGIN_HOST_POLICIES } from '../src/domains/plugin/manager/official-plugin-host-policies.js';

const requested = [
  'plugin.config.read',
  'plugin.state.get',
  'plugin.state.set',
  'thread.readContent',
  'thread.listMetadata',
  'messaging.send',
  'schedule.register',
] as const;
const sorted = (values: readonly string[]) => [...values].sort();
const manifest = (capabilities: readonly string[] = requested, pluginId = 'dev.clowder.issue-workbench') =>
  ({
    pluginId,
    version: '0.1.0-alpha.0',
    contractVersion: '0.1.0',
    name: 'Issue Workbench',
    features: [{ id: 'team-workbench', name: 'Team', resources: [], capabilities: [...capabilities] }],
    runtime: { transport: 'builtin', entrypoint: 'dist/team-plugin.js' },
  }) as PluginManifest;

test('Issue Workbench receives only its declared analysis, inbox and retained-state grants', () => {
  const resolve = (value: PluginManifest) => resolveLocalPluginEffectiveGrants(OFFICIAL_PLUGIN_HOST_POLICIES, value);
  assert.deepEqual(sorted(resolve(manifest())), sorted(requested));
  assert.deepEqual(resolve(manifest([])), []);
  assert.deepEqual(
    sorted(resolve(manifest([...requested, 'secret.read', 'thread.write', 'task.write']))),
    sorted(requested),
  );
  assert.deepEqual(resolve(manifest(requested, 'dev.example.issue-workbench')), []);
});

test('grant reconciliation preserves the existing installation identity and package records', async () => {
  const store = new MemoryPluginInventoryStore();
  const inventory = new HostInventoryControlPlane(store, {
    createInstanceId: () => 'pi_issue_workbench',
    now: () => 1,
  });
  const digest = `sha512-${createHash('sha512').update('isolated-issue-workbench-policy').digest('base64')}`;
  await inventory.installPackage({
    manifest: manifest(),
    computedPackageDigest: digest,
    expectedPackageDigest: digest,
    packagePluginId: 'dev.clowder.issue-workbench',
    effectiveGrants: [],
  });
  const before = await store.snapshot();
  const changes = await reconcileOfficialPluginGrants({
    store,
    inventory,
    hostPolicies: OFFICIAL_PLUGIN_HOST_POLICIES,
  });
  assert.deepEqual(changes, [
    {
      pluginId: 'dev.clowder.issue-workbench',
      pluginInstanceId: 'pi_issue_workbench',
      added: sorted(requested),
      removed: [],
    },
  ]);
  const after = await store.snapshot();
  assert.deepEqual(after.instances, before.instances);
  assert.deepEqual(after.packages, before.packages);
  assert.deepEqual(sorted(after.grants[0].effectiveGrants), sorted(requested));
  assert.deepEqual(
    await reconcileOfficialPluginGrants({ store, inventory, hostPolicies: OFFICIAL_PLUGIN_HOST_POLICIES }),
    [],
  );
});
