'use client';
import { useEffect, useRef, useState } from 'react';
import type { ProfileAuthType } from '../hub-accounts.types';

export function AccountAddMenu({ onAdd }: { onAdd: (type: ProfileAuthType) => void }) {
  const [open, setOpen] = useState(false);
  const owner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!owner.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  function choose(type: ProfileAuthType) {
    setOpen(false);
    onAdd(type);
  }
  return (
    <div
      className="account-add"
      ref={owner}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
    >
      <button
        type="button"
        className="account-primary"
        data-guide-id="accounts.create-form"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        + 添加账号
      </button>
      {open && (
        <div className="account-add-menu">
          <p>用官方工具登录（OAuth）</p>
          <button type="button" onClick={() => choose('oauth')}>
            Codex · 登录另一个账号
          </button>
          <small>本机默认登录不用添加。新增的号登录后不会自动换上。</small>
          <hr />
          <button type="button" onClick={() => choose('api_key')}>
            填一个 API 密钥
          </button>
          <small>填地址和密钥，再选模型。</small>
        </div>
      )}
    </div>
  );
}
