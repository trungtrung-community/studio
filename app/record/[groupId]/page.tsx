import {notFound} from 'next/navigation';

import {RecordingSession} from '@/components/recording-session';
import {loadRecordingSessionState} from '@/lib/server-context';

/** The session reads the ledger from disk and must never be prerendered. */
export const dynamic = 'force-dynamic';

/**
 * Written out rather than taken from Next's generated `PageProps`.
 *
 * The generated route types only exist after a successful build, so relying on
 * them here would make a clean checkout fail to typecheck until it had built.
 */
interface RecordGroupPageProps {
  params: Promise<{groupId: string}>;
  searchParams: Promise<{item?: string | string[]}>;
}

export default async function RecordGroupPage({params, searchParams}: RecordGroupPageProps) {
  const {groupId} = await params;
  const {item} = await searchParams;

  const session = await loadRecordingSessionState(groupId);
  if (!session) {
    notFound();
  }

  return (
    <RecordingSession
      group={session.group}
      recordedItemIds={session.recordedItemIds}
      setAsideItemIds={session.setAsideItemIds}
      hasFreshRoomTone={session.hasFreshRoomTone}
      startAtItemId={typeof item === 'string' ? item : undefined}
    />
  );
}
