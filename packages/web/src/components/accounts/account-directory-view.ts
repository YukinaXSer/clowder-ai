import { builtinAccountIdForClient, type ClientId } from '@cat-cafe/shared';
import type { CatData } from '@/hooks/useCatData';
import type { AccountMember, AccountSelection, ProfileItem } from '../hub-accounts.types';
import { builtinClientLabel } from '../hub-accounts.view';

export function accountProvider(account: ProfileItem): string {
  if (account.authType === 'oauth') return builtinClientLabel(account.clientId);
  if (!account.baseUrl) return account.clientId ? builtinClientLabel(account.clientId) : '自定义地址';
  try {
    const host = new URL(account.baseUrl).hostname;
    const providers: Array<[string, string]> = [
      ['anthropic.com', 'Anthropic'],
      ['openai.com', 'OpenAI'],
      ['googleapis.com', 'Google'],
      ['moonshot.cn', 'Kimi'],
      ['moonshot.ai', 'Kimi'],
      ['minimax.io', 'MiniMax'],
      ['minimaxi.com', 'MiniMax'],
      ['deepseek.com', 'DeepSeek'],
      ['openrouter.ai', 'OpenRouter'],
    ];
    return providers.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] ?? '自定义地址';
  } catch {
    return '自定义地址';
  }
}
export function accountMembers(account: ProfileItem, cats: CatData[], selection?: AccountSelection): AccountMember[] {
  if (account.clientId === 'openai' && selection) return selection.members.filter((m) => m.accountRef === account.id);
  return cats
    .filter(
      (cat) =>
        cat.id !== 'gpt-pro' &&
        cat.cli &&
        (cat.accountRef ?? builtinAccountIdForClient(cat.clientId as ClientId)) === account.id,
    )
    .map((cat) => ({
      id: cat.id,
      name: cat.nickname || cat.displayName,
      avatar: cat.avatar,
      accountRef: account.id,
      searchText: [cat.name, cat.displayName, cat.nickname, cat.breedDisplayName, cat.id].filter(Boolean).join(' '),
      available: cat.roster?.available !== false,
      bindingMode: cat.accountBindingMode,
    }));
}
export function accountIsSelected(account: ProfileItem, cats: CatData[], selection?: AccountSelection): boolean {
  if (account.clientId === 'openai') return selection?.accountRef === account.id;
  const local = cats.filter(
    (cat) => cat.id !== 'gpt-pro' && cat.cli && cat.clientId === account.clientId && cat.roster?.available !== false,
  );
  return (
    local.length > 0 &&
    local.every((cat) => (cat.accountRef ?? builtinAccountIdForClient(cat.clientId as ClientId)) === account.id)
  );
}
export function accountLoginReady(account: ProfileItem) {
  return account.codex ? account.codex.status === 'ready' : account.codexLoginStatus === 'ready';
}
export function accountStatus(account: ProfileItem) {
  if (account.authType === 'api_key')
    return { label: account.hasApiKey ? '密钥已填' : '没填密钥', detail: '', ready: false };
  const attempt = account.codex?.attempt;
  const ready = accountLoginReady(account);
  const waiting = ['preparing', 'queued', 'waiting'].includes(attempt?.state ?? '');
  let detail = account.nativeLogin?.identity?.email ?? '';
  if (waiting) detail = attempt?.state === 'waiting' ? '终端已打开，请在终端里完成授权' : '正在准备官方终端登录';
  else if (attempt?.state === 'review') detail = '请确认这次登录的身份';
  else if (attempt?.error) detail = `${ready ? '上次重新登录没成功：' : ''}${attempt.error}`;
  else if (attempt?.state === 'canceled') detail = '已取消这次登录';
  const unreadable =
    account.codexLoginStatus === 'unreadable' ||
    account.codex?.status === 'identity_changed' ||
    (!account.codex && !account.codexLoginStatus);
  return { label: ready ? '已登录' : waiting ? '等待登录' : unreadable ? '读不到' : '没登录', detail, ready };
}
