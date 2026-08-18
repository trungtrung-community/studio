'use client';

import {Bar, BarChart, CartesianGrid, XAxis, YAxis} from 'recharts';

import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type {DailyCount} from '@/lib/progress-summary';

const CHART_CONFIG = {
  takes: {label: 'Takes', color: 'var(--chart-1)'},
} satisfies ChartConfig;

/** Renders a date as the day and month alone, which is all a bar needs. */
function toShortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Takes kept per day.
 *
 * Days with nothing recorded are absent rather than drawn as zero. The chart is
 * there to show the pace of the sittings that happened, and a row of empty days
 * between them says nothing about that pace.
 */
export function DailyTakesChart({dailyCounts}: {dailyCounts: DailyCount[]}) {
  if (dailyCounts.length === 0) {
    return null;
  }

  const data = dailyCounts.map((day) => ({...day, label: toShortDate(day.date)}));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pace</CardTitle>
        <CardDescription>Takes kept on each day that had a sitting.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={CHART_CONFIG} className="h-48 w-full">
          <BarChart data={data} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="takes" fill="var(--color-takes)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
