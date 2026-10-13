'use client';
import type { ProfileItem } from '../hub-accounts.types';

export function AccountRowMenu({
  account,
  busy,
  used,
  memberCount,
  canRelogin,
  onRename,
  onRelogin,
  onEdit,
  onDelete,
}: {
  account: ProfileItem;
  busy: boolean;
  used: boolean;
  memberCount: number;
  canRelogin: boolean;
  onRename: () => void;
  onRelogin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const native = account.builtin && account.authType === 'oauth';
  return (
    <details className="account-menu">
      <summary aria-label={`${account.displayName}更多操作`}>⋯</summary>
      <div>
        {native ? (
          <p>这个号由官方工具管理。退出或换号请在原工具里做。</p>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={onRename}>
              改备注
            </button>
            {account.codex && (
              <button type="button" disabled={busy || !canRelogin} onClick={onRelogin}>
                重新登录
              </button>
            )}
            {account.authType === 'api_key' && (
              <button type="button" disabled={busy} onClick={onEdit}>
                编辑
              </button>
            )}
            <button type="button" disabled={busy || used || memberCount > 0} onClick={onDelete}>
              删除登记
            </button>
            {memberCount > 0 && <small>还有 {memberCount} 只猫在用，先换走</small>}
            {used && !memberCount && <small>工具正在用这个号，先换走</small>}
          </>
        )}
      </div>
    </details>
  );
}
