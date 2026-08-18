import Link from 'next/link';

import {Badge} from '@/components/ui/badge';
import {Card} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import type {GroupProgress} from '@/lib/progress-summary';

/**
 * A group, sized so a sitting ends on a natural boundary.
 *
 * The whole row is the link. At two thousand takes the studio is opened often,
 * and hunting for a small target is the kind of friction that accumulates.
 */
function GroupRow({group}: {group: GroupProgress}) {
  // Done means nothing is outstanding, which includes the cards deliberately
  // passed over. A group held open by one wrong card reads as unfinished work
  // when the work has in fact been done.
  const isComplete = group.recordedTakes + group.setAsideItems === group.totalTakes;

  return (
    <div className="flex items-center gap-2 rounded-md pr-2 transition-colors hover:bg-accent">
      <Link href={`/record/${group.id}`} className="flex min-w-0 flex-1 items-center gap-4 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{group.title}</span>
            {isComplete ? (
              <Badge variant="secondary" className="shrink-0">
                done
              </Badge>
            ) : null}
            {group.flaggedTakes > 0 ? (
              <Badge variant="destructive" className="shrink-0">
                {group.flaggedTakes} to check
              </Badge>
            ) : null}
            {group.setAsideItems > 0 ? (
              <Badge variant="outline" className="shrink-0">
                {group.setAsideItems} set aside
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{group.description}</p>
        </div>

        <Progress
          value={(group.recordedTakes / group.totalTakes) * 100}
          className="hidden h-2 w-40 sm:block"
        />

        <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {group.recordedTakes} / {group.totalTakes}
        </span>
      </Link>

      <Link
        href={`/browse/${group.id}`}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-fg-accent"
      >
        browse
      </Link>
    </div>
  );
}

/** One track's groups, with its own running total. */
function TrackSection({title, groups}: {title: string; groups: GroupProgress[]}) {
  const recorded = groups.reduce((total, group) => total + group.recordedTakes, 0);
  const planned = groups.reduce((total, group) => total + group.totalTakes, 0);

  return (
    <Card className="gap-2 p-4">
      <div className="flex items-baseline justify-between px-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {recorded} / {planned}
        </span>
      </div>
      <div className="divide-y">
        {groups.map((group) => (
          <GroupRow key={group.id} group={group} />
        ))}
      </div>
    </Card>
  );
}

/** Both tracks, each group linking straight into a recording session. */
export function GroupTree({groups}: {groups: GroupProgress[]}) {
  return (
    <div className="space-y-4">
      <TrackSection title="Read" groups={groups.filter((group) => group.track === 'read')} />
      <TrackSection title="Speak" groups={groups.filter((group) => group.track === 'speak')} />
    </div>
  );
}
