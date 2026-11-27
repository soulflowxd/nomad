// Adapted from shadcn/ui (MIT). https://ui.shadcn.com
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      data-slot="card"
      className={cn('flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex items-start justify-between gap-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('text-sm font-semibold leading-none', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-xs text-muted-foreground', className)} {...props} />;
}
