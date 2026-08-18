import Link from 'next/link';
import {notFound} from 'next/navigation';

import {GroupBrowser} from '@/components/group-browser';
import {loadGroupBrowseState} from '@/lib/server-context';

/** The browse view reads the ledger from disk and must never be prerendered. */
export const dynamic = 'force-dynamic';

/**
 * Written out rather than taken from Next's generated `PageProps`.
 *
 * The generated route types only exist after a successful build, so relying on
 * them here would make a clean checkout fail to typecheck until it had built.
 */
interface BrowseGroupPageProps {
  params: Promise<{groupId: string}>;
}

export default async function BrowseGroupPage({params}: BrowseGroupPageProps) {
  const {groupId} = await params;

  const browse = await loadGroupBrowseState(groupId);
  if (!browse) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-8">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-xs tracking-[var(--tracking-caps)] text-muted-foreground uppercase hover:text-fg-accent"
        >
          ← all groups
        </Link>
        <h1 className="font-heading text-3xl font-extrabold">{browse.group.title}</h1>
        <p className="text-sm text-muted-foreground">{browse.group.description}</p>
      </header>

      <GroupBrowser groupId={browse.group.id} items={browse.items} />
    </main>
  );
}
