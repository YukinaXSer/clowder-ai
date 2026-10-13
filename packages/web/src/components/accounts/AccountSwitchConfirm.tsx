'use client';
import { useEffect, useState } from 'react';
import { accountRequest } from '../codex-accounts/account-request';
import type { AccountSelection, ProfileItem } from '../hub-accounts.types';

interface Preview {
  previewToken: string;
  accountRef: string;
  targets: Array<{ catId: string; name: string; previousAccountRef: string }>;
  exceptions: Array<{ catId: string; name: string; previousAccountRef: string; previousAccountName?: string }>;
  selection?: AccountSelection;
}
export function AccountSwitchConfirm({
  account,
  onClose,
  onChanged,
}: {
  account: ProfileItem;
  onClose: () => void;
  onChanged: (selection: AccountSelection) => void;
}) {
  const [includeOverrides, setIncludeOverrides] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setPreview(undefined);
    setError('');
    void accountRequest<Preview>(`/api/accounts/${encodeURIComponent(account.id)}/codex/binding/preview`, {
      scope: 'local',
      includeOverrides,
    })
      .then((result) => {
        if (current) setPreview(result);
      })
      .catch((e) => {
        if (current) setError(e instanceof Error ? e.message : '无法预览换号');
      });
    return () => {
      current = false;
    };
  }, [account.id, includeOverrides]);
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const result = await accountRequest<Preview>(
        `/api/accounts/${encodeURIComponent(account.id)}/codex/binding/commit`,
        { scope: 'local', includeOverrides, previewToken: preview.previewToken },
      );
      if (!result.selection) throw new Error('换号结果读不到，请刷新核对');
      onChanged(result.selection);
      window.dispatchEvent(new CustomEvent('accounts-changed'));
      window.dispatchEvent(new CustomEvent('cat-config-changed'));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '换号失败');
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-switch-confirm" aria-label="换号确认">
      <h3>换成「{account.displayName}」</h3>
      <p>从下一次调用起生效。正在进行的调用继续用旧号，原会话和历史记录保留。</p>
      <p>本机默认登录不受影响，可随时在账号列表换回来。云端 Pro 不跟着换。</p>
      {error && <p role="alert">{error}</p>}
      {preview ? (
        <>
          <p>会跟着换的 {preview.targets.length} 只：</p>
          <p>{preview.targets.map((m) => m.name).join('、') || '没有成员；只设定这一家正在用的账号'}</p>
          {preview.exceptions.length > 0 && (
            <div>
              <p>
                现在用别的号的 {preview.exceptions.length} 只：
                {preview.exceptions
                  .map((m) => `${m.name}（${m.previousAccountName ?? m.previousAccountRef}）`)
                  .join('、')}
              </p>
              <p>这些猫保留原号，记为单独指定。</p>
            </div>
          )}
          {(preview.exceptions.length > 0 || includeOverrides) && (
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={includeOverrides}
                  disabled={busy}
                  onChange={(e) => setIncludeOverrides(e.target.checked)}
                />
                也一起换
              </label>
              {includeOverrides && <p>例外已纳入上方换号名单；取消勾选可保留它们原来的账号。</p>}
            </div>
          )}
          <button type="button" className="account-primary" disabled={busy} onClick={() => void commit()}>
            确认换号
          </button>
        </>
      ) : (
        !error && <p>正在读取影响名单…</p>
      )}
      <button type="button" className="account-button" disabled={busy} onClick={onClose}>
        取消
      </button>
    </section>
  );
}
