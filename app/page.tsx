import Link from 'next/link';

import {DailyTakesChart} from '@/components/daily-takes-chart';
import {DissentPanel} from '@/components/dissent-panel';
import {GroupTree} from '@/components/group-tree';
import {QualityPanel} from '@/components/quality-panel';
import {SetAsidePanel} from '@/components/set-aside-panel';
import {ThemeToggle} from '@/components/theme-toggle';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Card, CardDescription, CardTitle} from '@/components/ui/card';
import {summariseProgress} from '@/lib/progress-summary';
import {getStudioContext} from '@/lib/server-context';
import {hasUsableBackupPath} from '@/lib/studio-config';
import {deriveLedgerState, readLedger} from '@/lib/take-ledger';

/** The dashboard reads the ledger from disk and must never be prerendered. */
export const dynamic = 'force-dynamic';

/**
 * One figure and what it counts.
 *
 * The figure carries the display face at the top of the type ramp and the
 * label sits under it in small caps, so a row of four reads as four numbers
 * rather than four identical boxes.
 */
function Statistic({value, label, hint}: {value: string; label: string; hint?: string}) {
  return (
    <Card className="gap-0 p-6">
      <CardTitle className="font-heading text-4xl leading-[var(--leading-display)] font-extrabold tracking-[var(--tracking-display)] tabular-nums">
        {value}
      </CardTitle>
      <CardDescription className="mt-2 text-xs font-semibold tracking-[var(--tracking-caps)] text-fg-accent uppercase">
        {label}
      </CardDescription>
      {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export default async function DashboardPage() {
  const {config, plan} = getStudioContext();
  const state = deriveLedgerState(readLedger(config.dataPath));
  const summary = summariseProgress(plan, state);

  // Cards being passed over are neither done nor outstanding, so they come out
  // of this figure. It means "still to say", not "still open for any reason".
  const remaining = summary.totalTakes - summary.recordedTakes - summary.setAsideItems;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 p-8">
      <header className="flex items-start justify-between gap-6">
        <div className="space-y-2">
          <h1 className="font-heading text-3xl font-extrabold">Trungtrung Studio</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Every take is computed from the content in{' '}
            <code className="font-mono text-xs text-fg-accent">{config.designSystemPath}</code>.
            No figure here is written down by hand.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {hasUsableBackupPath(config) ? null : (
        <Alert variant="destructive">
          <AlertTitle>No backup location is set</AlertTitle>
          <AlertDescription>
            Masters are the only thing here that cannot be produced again without recording
            it again, and they are not in git. Set{' '}
            <code className="font-mono text-xs">backupPath</code> in{' '}
            <code className="font-mono text-xs">studio.config.json</code> before a session.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Statistic value={summary.recordedTakes.toLocaleString()} label="recorded" />
        <Statistic value={remaining.toLocaleString()} label="still to record" />
        <Statistic
          value={summary.setAsideItems.toLocaleString()}
          label="set aside"
          hint="passed over as wrong"
        />
        <Statistic
          value={summary.totalTakes.toLocaleString()}
          label="takes in all"
          hint="words, phrases and the Read track"
        />
        <Statistic
          value={summary.estimatedSessionsRemaining?.toString() ?? '—'}
          label="sittings left"
          hint={
            summary.averageTakesPerSession
              ? `at ${summary.averageTakesPerSession} a sitting so far`
              : 'once there is a rate to measure'
          }
        />
      </section>

      <DailyTakesChart dailyCounts={summary.dailyCounts} />

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-bold">Groups</h2>
        <GroupTree groups={summary.groups} />
      </section>

      {summary.orphanedItemIds.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>
            {summary.orphanedItemIds.length} recorded against ids the content no longer has
          </AlertTitle>
          <AlertDescription>
            Correcting a word&rsquo;s English handle, or a syllable&rsquo;s spelling, changes
            its id — so these takes belong to cards that no longer exist and are left out of
            the export. Their replacements are in the queue as unrecorded.
            <br />
            <code className="font-mono text-xs">
              {summary.orphanedItemIds.slice(0, 6).join(', ')}
              {summary.orphanedItemIds.length > 6 ? ' …' : ''}
            </code>
          </AlertDescription>
        </Alert>
      ) : null}

      <QualityPanel flaggedTakes={summary.flaggedTakes} />
      <SetAsidePanel setAside={summary.setAside} corrected={summary.corrected} />
      <DissentPanel dissent={summary.dissent} />

      <footer className="border-t pt-6 text-xs text-muted-foreground">
        After a session run <code className="font-mono text-fg-accent">npm run master</code>,
        then <code className="font-mono text-fg-accent">npm run bundle</code> to produce the
        folder the content pipeline imports.{' '}
        <Link href="/api/plan" className="text-fg-link underline underline-offset-2">
          Inspect the raw plan
        </Link>
        .
      </footer>
    </main>
  );
}
