import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type AccountConfig, builtinAccountIdForClient, type ClientId } from '@cat-cafe/shared';
import { resolveByAccountRef } from '../config/account-resolver.js';
import { resolveCatCatalogPath } from '../config/cat-catalog-store.js';
import { loadCatConfig, toAllCatConfigs } from '../config/cat-config-loader.js';
import { inspectCodexLogin } from '../config/codex-account-identity.js';
import { codexCanonicalPath, resolveCodexAccountLaunch } from '../config/codex-account-launch.js';
import { resolveActiveProjectRoot } from '../utils/active-project-root.js';

/** Defaults already used by configured local tools, without registration/bootstrap side effects. */
export function listNativeAccountDefaults(projectRoot: string): Array<[string, AccountConfig]> {
  const path = resolveCatCatalogPath(resolveActiveProjectRoot());
  if (!existsSync(path)) return [];
  const clients = new Set(
    Object.values(toAllCatConfigs(loadCatConfig(path)))
      .filter((cat) => cat.id !== 'gpt-pro' && cat.cli)
      .map((cat) => cat.clientId),
  );
  return [...clients].flatMap((client) => {
    const id = builtinAccountIdForClient(client as ClientId);
    if (!id) return [];
    const profile = resolveByAccountRef(projectRoot, id);
    return profile?.authType === 'oauth'
      ? [[id, { authType: 'oauth' as const, clientId: client as ClientId }] as [string, AccountConfig]]
      : [];
  });
}

export function inspectNativeAccountDefaults(projectRoot: string) {
  try {
    return { defaults: listNativeAccountDefaults(projectRoot) };
  } catch {
    return { defaults: [], error: '运行成员信息读不到，本机默认账号列表未能补全' };
  }
}

export function nativeCodexAccountView(projectRoot: string, id: string) {
  const account = resolveByAccountRef(projectRoot, id);
  if (!account) return { codexLoginStatus: 'unreadable' as const };
  try {
    const home = resolveCodexAccountLaunch(account, { cwd: projectRoot }).credentialHome;
    const observation = inspectCodexLogin(home, projectRoot);
    const officialHome = codexCanonicalPath(resolve(process.env.HOME || homedir(), '.codex'), projectRoot);
    const official = home === officialHome;
    return {
      codexLoginStatus: observation.status,
      nativeLogin: {
        home,
        officialDefault: official,
        ...(observation.identity ? { identity: observation.identity } : {}),
      },
      displayName: official ? 'Codex App 登录（本机默认）' : '本机默认登录',
    };
  } catch {
    return { codexLoginStatus: 'unreadable' as const, displayName: '本机默认登录' };
  }
}
