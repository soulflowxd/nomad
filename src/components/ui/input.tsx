// Adapted from shadcn/ui (MIT). https://ui.shadcn.com
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}
