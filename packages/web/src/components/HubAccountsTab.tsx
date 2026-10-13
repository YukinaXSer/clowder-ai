'use client';
import { Fragment, useMemo, useState } from 'react';
import { useCatData } from '@/hooks/useCatData';
import { AccountAddMenu } from './accounts/AccountAddMenu';
import { AccountDirectoryRow } from './accounts/AccountDirectoryRow';
import { AccountSwitchConfirm } from './accounts/AccountSwitchConfirm';
import { accountIsSelected, accountMembers, accountProvider } from './accounts/account-directory-view';
import { useAccountDirectory } from './accounts/useAccountDirectory';
import type { ProfileAuthType, ProfileItem } from './hub-accounts.types';
import { normalizeBuiltinClientIds } from './hub-accounts.view';
import { type UnifiedAuthEditData, UnifiedAuthModal } from './UnifiedAuthModal';
import './accounts/account-directory.css';

export function HubAccountsTab() {
  const directory = useAccountDirectory();
  const { cats } = useCatData();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [addType, setAddType] = useState<ProfileAuthType>('oauth');
  const [editTarget, setEditTarget] = useState<UnifiedAuthEditData>();
  const [switchTarget, setSwitchTarget] = useState<ProfileItem>();
  const [actionError, setActionError] = useState<{ ref: string; message: string }>();
  const [brokenOpen, setBrokenOpen] = useState(false);
  const profiles = useMemo(() => normalizeBuiltinClientIds(directory.data?.providers ?? []), [directory.data]);
  const rows = profiles.map((account) => ({
    account,
    provider: accountProvider(account),
    members: accountMembers(account, cats, directory.selection),
    used: accountIsSelected(account, cats, directory.selection),
  }));
  const counts = {
    all: rows.length,
    oauth: rows.filter((r) => r.account.authType === 'oauth').length,
    api_key: rows.filter((r) => r.account.authType === 'api_key').length,
  };
  const sorted = rows.sort((a, b) => {
    const count = (provider: string) =>
      rows.filter((r) => r.provider === provider).reduce((n, r) => n + r.members.filter((m) => m.available).length, 0);
    return (
      count(b.provider) - count(a.provider) ||
      a.provider.localeCompare(b.provider) ||
      Number(b.used) - Number(a.used) ||
      a.account.displayName.localeCompare(b.account.displayName)
    );
  });
  const visible = sorted.filter(
    (row) =>
      (filter === 'all' || row.account.authType === filter) &&
      [
        row.provider,
        row.account.displayName,
        row.account.codex?.identity?.email ?? '',
        row.account.nativeLogin?.identity?.email ?? '',
        row.account.baseUrl ?? '',
        ...row.members.map((m) => `${m.name} ${m.searchText ?? ''}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const update = (next: ProfileItem[], removed?: string[]) => {
    directory.update(next, removed);
    if (actionError && (next.some((p) => p.id === actionError.ref) || removed?.includes(actionError.ref)))
      setActionError(undefined);
  };
  function edit(profile: ProfileItem) {
    setEditTarget({
      id: profile.id,
      displayName: profile.displayName,
      baseUrl: profile.baseUrl,
      clientId: profile.clientId,
      authType: profile.authType,
      models: profile.models,
      envVars: profile.envVars,
    });
    setShowAuthModal(true);
  }
  if (directory.loading && !directory.data) return <p>正在读取账号…</p>;
  return (
    <div className="account-directory">
      <div className="account-toolbar">
        <input
          type="search"
          aria-label="搜索账号"
          placeholder="搜哪一家、号名、邮箱，或猫的名字"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="account-filters" role="group" aria-label="账号筛选">
          {(
            [
              ['all', '全部'],
              ['oauth', 'OAuth 登录'],
              ['api_key', 'API 密钥'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label} {counts[value]}
            </button>
          ))}
        </div>
        <AccountAddMenu
          onAdd={(type) => {
            setEditTarget(undefined);
            setAddType(type);
            setShowAuthModal(true);
          }}
        />
      </div>
      {directory.error && (
        <p role="alert">
          {directory.error}{' '}
          <button type="button" className="account-button" onClick={() => void directory.refresh()}>
            重试读取
          </button>
        </p>
      )}
      {(directory.memberError || directory.data?.nativeDefaultsError) && (
        <p role="status">{directory.memberError || directory.data?.nativeDefaultsError}；正在用的账号暂不能确认。</p>
      )}
      {directory.selection?.state === 'mixed' && (
        <p className="account-notice">
          Codex 的猫现在分别用{' '}
          {new Set(directory.selection.members.filter((m) => m.available).map((m) => m.accountRef)).size} 个号：
          {profiles
            .filter((p) => directory.selection?.members.some((m) => m.available && m.accountRef === p.id))
            .map(
              (p) =>
                `${p.displayName} ${directory.selection?.members.filter((m) => m.available && m.accountRef === p.id).length} 只`,
            )
            .join('，')}
          。 选一个作为这一家正在用的号；用别的号的猫会先保留原号。
        </p>
      )}
      <div role="group" aria-label="Account List" data-guide-id="accounts.account-list">
        {(['oauth', 'api_key'] as const).map((type) => {
          const section = visible.filter((r) => r.account.authType === type);
          if (!section.length) return null;
          return (
            <section key={type} className="account-section">
              <h3>
                {type === 'oauth' ? 'OAuth 登录' : 'API 密钥'} · {section.length}
              </h3>
              <div className="account-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>哪一家</th>
                      <th>号</th>
                      <th>状态</th>
                      <th>谁在用</th>
                      <th>动作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.map((row, index) => (
                      <Fragment key={row.account.id}>
                        <AccountDirectoryRow
                          {...row}
                          provider={index === 0 || section[index - 1].provider !== row.provider ? row.provider : ''}
                          accounts={profiles}
                          refresh={directory.refresh}
                          update={update}
                          onSwitch={setSwitchTarget}
                          onEdit={edit}
                          actionError={
                            actionError?.ref === row.account.id && !row.account.codex?.attempt
                              ? actionError.message
                              : undefined
                          }
                        />
                        {switchTarget?.id === row.account.id && (
                          <tr className="account-expanded">
                            <td colSpan={5}>
                              <AccountSwitchConfirm
                                account={switchTarget}
                                onClose={() => setSwitchTarget(undefined)}
                                onChanged={directory.applyBinding}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {!visible.length && <p className="account-empty">{query ? '没有找到匹配的账号。' : '没有这类账号。'}</p>}
      </div>
      {!!directory.data?.unavailableAccounts?.length && (
        <section className="account-rejected">
          <button type="button" aria-expanded={brokenOpen} onClick={() => setBrokenOpen(!brokenOpen)}>
            {directory.data.unavailableAccounts.length} 个用不了的旧账号 {brokenOpen ? '⌃' : '⌄'}
          </button>
          {brokenOpen && (
            <ul>
              {directory.data.unavailableAccounts.map((row) => (
                <li key={row.accountRef}>
                  <strong>{row.accountRef}</strong>：{row.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <UnifiedAuthModal
        key={editTarget?.id ?? `create-${addType}`}
        initialAuthType={addType}
        open={showAuthModal}
        editProfile={editTarget}
        onClose={() => {
          setShowAuthModal(false);
          setEditTarget(undefined);
        }}
        onCreated={(ref, error, profile) => {
          setShowAuthModal(false);
          setEditTarget(undefined);
          setActionError(error ? { ref, message: `登录未能确认：${error}。可以在这一行重试。` } : undefined);
          if (profile) update([profile]);
          void directory.refresh();
        }}
      />
    </div>
  );
}
