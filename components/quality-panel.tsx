import Link from 'next/link';

import {TibetanText} from '@/components/tibetan-text';
import {Badge} from '@/components/ui/badge';
import {Card, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {FlaggedTake} from '@/lib/progress-summary';

/**
 * Takes that measured badly, and where to find them.
 *
 * None of these were rejected. The speaker heard each one and kept it, so this
 * is not a list of mistakes. It catches what an ear misses at the end of a long
 * sitting, so a clipped or near-silent take is found now rather than after the
 * last one is recorded.
 */
export function QualityPanel({flaggedTakes}: {flaggedTakes: FlaggedTake[]}) {
  if (flaggedTakes.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Worth listening to again</CardTitle>
        <CardDescription>
          {flaggedTakes.length} kept {flaggedTakes.length === 1 ? 'take' : 'takes'} measured
          outside the usual range. Nothing here is rejected.
        </CardDescription>
      </CardHeader>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Item</TableHead>
            <TableHead className="w-40">Group</TableHead>
            <TableHead>What was measured</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flaggedTakes.map((take) => (
            <TableRow key={take.itemId}>
              <TableCell>
                <Link
                  href={`/record/${take.groupId}?item=${encodeURIComponent(take.itemId)}`}
                  className="hover:underline"
                >
                  <TibetanText className="text-lg">{take.tibetan}</TibetanText>
                  {take.romanization ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {take.romanization}
                    </span>
                  ) : null}
                </Link>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {take.groupTitle}
              </TableCell>
              <TableCell className="space-y-1">
                {take.warnings.map((warning) => (
                  <div key={warning.kind} className="flex items-center gap-2">
                    <Badge variant="outline" className="shrink-0">
                      {warning.kind}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{warning.message}</span>
                  </div>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
