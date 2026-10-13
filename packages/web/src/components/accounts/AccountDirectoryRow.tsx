'use client';
import { Fragment, useState } from 'react';
import { AvatarImageWithFallback } from '../AvatarImageWithFallback';
import { accountRequest } from '../codex-accounts/account-request';
import { CodexQuotaControl } from '../codex-accounts/CodexQuotaControl';
import type { AccountMember, ProfileItem } from '../hub-accounts.types';
import { useConfirm } from '../useConfirm';
import { AccountRowMenu } from './AccountRowMenu';
import { accountStatus } from './account-directory-view';

export function AccountDirectoryRow({
  account,
  accounts,
  members,
  used,
  provider,
  refresh,
  update,
  onSwitch,
  onEdit,
  actionError,
}: {
  account: ProfileItem;
  accounts: ProfileItem[];
  members: AccountMember[];
  used: boolean;
  provider: string;
  refresh: () => Promise<void>;
  update: (profiles: ProfileItem[], removed?: string[]) => void;
  onSwitch: (profile: ProfileItem) => void;
  onEdit: (profile: ProfileItem) => void;
  actionError?: string;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(account.displayName);
  const status = accountStatus(account);
  const attempt = account.codex?.attempt;
  const waiting = ['preparing', 'queued', 'waiting'].includes(attempt?.state ?? '');
  const review = attempt?.state === 'review';
  const failed = ['failed', 'timeout', 'interrupted', 'canceled', 'superseded'].includes(attempt?.state ?? '');
  const active = members.filter((m) => m.available);
  const duplicate = accounts.find((p) => p.id === attempt?.duplicateAccountRef);
  const native = account.builtin && account.authType === 'oauth';
  const id = `account-row-${encodeURIComponent(account.id)}`;
  async function login(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    try {
      const result = await accountRequest<{ profiles: ProfileItem[] }>(
        `/api/accounts/${encodeURIComponent(account.id)}/codex/login/${action}`,
        { attemptId: attempt?.id, ...extra },
      );
      update(result.profiles);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  async function remove(focusRef?: string) {
    if (
      !focusRef &&
      !(await confirm({
        title: '删除登记',
        variant: 'danger',
        confirmLabel: '删除登记',
        message: `删除「${account.displayName}」？只删这里的登记，不会注销官方账号。`,
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await accountRequest(`/api/accounts/${encodeURIComponent(account.id)}`, {}, 'DELETE');
      update([], [account.id]);
      void refresh();
      if (focusRef) {
        const target = document.getElementById(`account-row-${encodeURIComponent(focusRef)}`);
        target?.scrollIntoView?.({ block: 'center' });
        target?.focus();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }
  async function rename() {
    setBusy(true);
    setError('');
    try {
      const result = await accountRequest<{ profile: ProfileItem }>(
        `/api/accounts/${encodeURIComponent(account.id)}`,
        { displayName: note },
        'PATCH',
      );
      update([result.profile]);
      setEditing(false);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '修改失败');
    } finally {
      setBusy(false);
    }
  }
  const action = review
    ? '去处理'
    : waiting
      ? '取消'
      : account.codex && (failed || !status.ready)
        ? '重试'
        : status.ready && !used
          ? '换成这个'
          : '';
  return (
    <Fragment>
      <tr data-account-id={account.id} id={id} tabIndex={-1}>
        <td className="account-provider">{provider}</td>
        <td>
          <button type="button" className="account-name" aria-expanded={open} onClick={() => setOpen(!open)}>
            {account.displayName}
          </button>
          <small>
            {native
              ? account.nativeLogin?.officialDefault === false
                ? account.nativeLogin.home
                : '本机默认登录，归原工具管理'
              : (account.codex?.identity?.email ?? account.baseUrl ?? '')}
          </small>
        </td>
        <td>
          <span className={`account-state ${status.ready ? 'account-state-ready' : ''}`}>{status.label}</span>
          <small>{status.detail}</small>
        </td>
        <td>
          <div className="account-followers">
            {used && <span className="account-used">正在用</span>}
            {!used && active.some((m) => m.bindingMode === 'override') && <span>单独指定</span>}
            {active.slice(0, 5).map((m) => (
              <AvatarImageWithFallback
                key={m.id}
                src={m.avatar ?? '/avatars/codex.png'}
                alt={m.name}
                className="account-avatar"
              />
            ))}
            <span>{active.length ? `${active.length} 只猫` : '—'}</span>
          </div>
        </td>
        <td>
          <div className="account-row-actions">
            {action && (
              <button
                type="button"
                className="account-button"
                disabled={busy}
                onClick={() =>
                  review
                    ? setOpen(true)
                    : waiting
                      ? void login('cancel')
                      : action === '重试'
                        ? void login('start')
                        : onSwitch(account)
                }
              >
                {action}
              </button>
            )}
            <AccountRowMenu
              account={account}
              busy={busy}
              used={used}
              memberCount={members.length}
              canRelogin={!waiting && !review}
              onRename={() => {
                setNote(account.displayName);
                setEditing(true);
                setOpen(true);
              }}
              onRelogin={() => void login('start')}
              onEdit={() => onEdit(account)}
              onDelete={() => void remove()}
            />
            <button
              type="button"
              className="account-expand"
              aria-label={`展开${account.displayName}`}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? '⌃' : '⌄'}
            </button>
          </div>
        </td>
      </tr>
      {(open || error || actionError) && (
        <tr className="account-expanded">
          <td colSpan={5}>
            {(error || actionError) && <p role="alert">{error || actionError}</p>}
            {open && (
              <div className="account-details">
                {editing && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <input
                      aria-label="修改账号备注"
                      maxLength={200}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <button type="submit" className="account-button" disabled={busy}>
                      保存
                    </button>
                    <button type="button" className="account-button" onClick={() => setEditing(false)}>
                      取消
                    </button>
                  </form>
                )}
                <p>用这个号的猫：{active.map((m) => m.name).join('、') || '没有'}。云端 Pro 不跟本机换号。</p>
                {active.some((m) => m.bindingMode === 'override') && <p>单独指定的猫在成员详情里改。</p>}
                {review && (
                  <div className="account-identity-review">
                    {attempt?.duplicateAccountRef && !duplicate ? (
                      <>
                        <p>已有账号暂时读不到。登记和绑定保持原样，请取消这次登录后核对已有账号。</p>
                        <button
                          type="button"
                          className="account-button"
                          disabled={busy}
                          onClick={() => void login('cancel')}
                        >
                          放弃这次登录
                        </button>
                      </>
                    ) : duplicate && !account.codex?.identity ? (
                      <>
                        <p>登录的是列表里已有的「{duplicate.displayName}」，这一条登记是多余的。</p>
                        <button
                          type="button"
                          className="account-button"
                          disabled={busy || members.length > 0}
                          onClick={() => void remove(duplicate.id)}
                        >
                          删掉这条，回到{duplicate.displayName}
                        </button>
                        <button type="button" className="account-button" onClick={() => setOpen(false)}>
                          先留着
                        </button>
                      </>
                    ) : (
                      <>
                        <p>
                          这次登进的是另一个号（{attempt?.identity?.email ?? '官方身份'}）。原来的号和跟着它的猫都没动。
                        </p>
                        {!duplicate && (
                          <button
                            type="button"
                            className="account-button"
                            disabled={busy}
                            onClick={() =>
                              void login('create-new', { displayName: `${account.displayName}（新账号）` })
                            }
                          >
                            另存为新号
                          </button>
                        )}
                        {duplicate && <p>这个身份已在「{duplicate.displayName}」登记，可放弃这次登录后选择它。</p>}
                        <button
                          type="button"
                          className="account-button"
                          disabled={busy}
                          onClick={() => void login('cancel')}
                        >
                          放弃这次登录
                        </button>
                      </>
                    )}
                  </div>
                )}
                {account.clientId === 'openai' && status.ready && (
                  <CodexQuotaControl
                    accountRef={account.id}
                    observation={account.quota}
                    reload={refresh}
                    managed={!!account.codex}
                    identity={account.codex?.identity}
                  />
                )}
                {account.authType === 'api_key' ? (
                  <p>余额请到服务商那里看。</p>
                ) : account.clientId === 'openai' && !status.ready ? (
                  <p>这个号查不了额度。</p>
                ) : null}
                {(account.codex || account.nativeLogin) && (
                  <details>
                    <summary>登录信息</summary>
                    <p>登录目录：{account.codex?.credentialHome ?? account.nativeLogin?.home}</p>
                    {(account.codex?.identity?.workspaceId ?? account.nativeLogin?.identity?.workspaceId) && (
                      <p>
                        工作区 ID：{account.codex?.identity?.workspaceId ?? account.nativeLogin?.identity?.workspaceId}
                      </p>
                    )}
                  </details>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
