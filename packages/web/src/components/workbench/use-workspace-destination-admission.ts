import { useCallback, useEffect, useState } from 'react';
import { useShellCopy } from '@/components/shell/shell-copy';
import type { WorkspaceLauncherDestination } from '@/components/workspace/WorkspaceLauncher';
import type { WorkspaceSurfaceDescriptor } from './workbench-contract';
import { workspaceChromeCopy } from './workspace-chrome.shell-copy';
import { type WorkspaceHomeAdapterContext, workspaceHomeDestinationToSurface } from './workspace-home-adapter';

export interface WorkspaceDestinationAdmission {
  onSelectDestination: (destination: WorkspaceLauncherDestination) => void;
  message: string | null;
}

/** Home and its disposable tools menu share the original worktree admission, not another destination store. */
export function useWorkspaceDestinationAdmission({
  context,
  worktreeLoading,
  worktreeError,
  onSelectSurface,
  enabled = true,
}: {
  context: WorkspaceHomeAdapterContext;
  worktreeLoading: boolean;
  worktreeError: string | null;
  onSelectSurface: (surface: WorkspaceSurfaceDescriptor) => void;
  enabled?: boolean;
}): WorkspaceDestinationAdmission {
  const t = useShellCopy(workspaceChromeCopy);
  const [pending, setPending] = useState<{ threadId?: string; destination: WorkspaceLauncherDestination } | null>(null);
  const [notice, setNotice] = useState<{ threadId?: string; message: string } | null>(null);
  const onSelectDestination = useCallback(
    (destination: WorkspaceLauncherDestination) => {
      if (!enabled) return;
      const surface = workspaceHomeDestinationToSurface(destination, context);
      if (surface) {
        setPending(null);
        setNotice(null);
        onSelectSurface(surface);
      } else if (destination.kind === 'surface' && ['files', 'changes', 'terminal'].includes(destination.id)) {
        setPending(worktreeLoading ? { threadId: context.threadId, destination } : null);
        setNotice({
          threadId: context.threadId,
          message: worktreeLoading
            ? t.destinationLoading(destination.label)
            : (worktreeError ?? t.destinationUnavailable(destination.label)),
        });
      }
    },
    [context, enabled, onSelectSurface, t, worktreeError, worktreeLoading],
  );

  useEffect(() => {
    if (!pending) return;
    if (!enabled || pending.threadId !== context.threadId) {
      setPending(null);
      setNotice(null);
      return;
    }
    const surface = workspaceHomeDestinationToSurface(pending.destination, context);
    if (surface) {
      setPending(null);
      setNotice(null);
      onSelectSurface(surface);
    } else if (!worktreeLoading) {
      setPending(null);
      setNotice({
        threadId: context.threadId,
        message: worktreeError ?? t.destinationUnavailable(pending.destination.label),
      });
    }
  }, [context, enabled, onSelectSurface, pending, t, worktreeError, worktreeLoading]);

  return { onSelectDestination, message: notice && notice.threadId === context.threadId ? notice.message : null };
}
