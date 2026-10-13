'use client';
import { type AccountQuotaObservation, accountQuotaOwnerMatches, type CodexAccountIdentity } from '@cat-cafe/shared';
import { useEffect, useRef, useState } from 'react';
import { SettingsSecondaryButton } from '../settings/primitives';
import { accountRequest } from './account-request';

export function CodexQuotaControl({
  accountRef,
  observation: suppliedObservation,
  reload,
  managed = false,
  identity,
}: {
  accountRef: string;
  observation?: AccountQuotaObservation;
  reload: () => Promise<void>;
  managed?: boolean;
  identity?: CodexAccountIdentity;
}) {
  const [busy, setBusy] = useState(false);
  const [storedObservation, setObservation] = useState(suppliedObservation);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const observation =
    managed && !accountQuotaOwnerMatches(storedObservation, accountRef, identity) ? undefined : storedObservation;
  useEffect(() => {
    setObservation(suppliedObservation);
  }, [suppliedObservation]);
  const [error, setError] = useState('');
  async function query() {
    setBusy(true);
    setError('');
    try {
      const result = await accountRequest<{ quota: AccountQuotaObservation }>(
        `/api/accounts/${encodeURIComponent(accountRef)}/codex/quota`,
        {},
      );
      if (managed && !accountQuotaOwnerMatches(result.quota, accountRef, identityRef.current))
        throw new Error('账号登录已变化，请重新查询');
      setObservation(result.quota);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法查询额度');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>账号额度</strong>
        <SettingsSecondaryButton disabled={busy} onClick={() => void query()}>
          {busy ? '正在查询…' : '查询此账号额度'}
        </SettingsSecondaryButton>
      </div>
      {observation?.status === 'ok' ? (
        <ul>
          {observation.items.map((item) => (
            <li key={`${item.poolId ?? ''}:${item.label}`}>
              {item.label}：剩余{' '}
              {Math.max(
                0,
                Math.min(100, item.percentKind === 'remaining' ? item.usedPercent : 100 - item.usedPercent),
              ).toFixed(0)}
              %
              {item.resetsAt
                ? ` · ${new Date(item.resetsAt).toLocaleString()} 重置`
                : item.resetsText
                  ? ` · ${item.resetsText}`
                  : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p>{observation?.error ?? '尚未查询，不代表额度为零'}</p>
      )}
      {observation && (
        <p className="text-[var(--cafe-text-muted)]">
          只读观测 · {new Date(observation.observedAt).toLocaleString()} 更新
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
