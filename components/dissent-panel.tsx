import {TibetanText} from '@/components/tibetan-text';
import {Card, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {DissentEntry} from '@/lib/progress-summary';

/**
 * Readings the speaker recorded but disagreed with.
 *
 * Around a third of vocabulary carries an open question for a native reviewer,
 * and the audio is draft exactly as the written form is. These notes are the
 * shortlist that pass should start from.
 */
export function DissentPanel({dissent}: {dissent: DissentEntry[]}) {
  if (dissent.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disagreed with while recording</CardTitle>
        <CardDescription>
          {dissent.length} {dissent.length === 1 ? 'note' : 'notes'} for the native review
          pass, each against the question that prompted it.
        </CardDescription>
      </CardHeader>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Item</TableHead>
            <TableHead className="w-1/3">Open question</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dissent.map((entry) => (
            <TableRow key={`${entry.itemId}-${entry.recordedAt}`}>
              <TableCell>
                <TibetanText className="text-lg">{entry.tibetan}</TibetanText>
                <p className="text-xs text-muted-foreground">{entry.groupTitle}</p>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {entry.reviewQuestion ?? '—'}
              </TableCell>
              <TableCell className="text-sm">{entry.note}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
