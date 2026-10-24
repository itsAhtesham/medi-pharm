import Link from 'next/link';
import { ArrowLeft, ArrowRight, Inbox } from 'lucide-react';
import { Button } from './ui/button';
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title break-words [overflow-wrap:anywhere]">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox className="mx-auto mb-3 text-primary/60" size={32} />
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mb-5 mt-2 max-w-sm">{description}</p>
      {children}
    </div>
  );
}
export function Pagination({
  total,
  page,
  size = 25,
  base,
  query = {},
  pageParam = 'page',
  itemName = 'record',
}: {
  total: number;
  page: number;
  size?: number;
  base: string;
  query?: Record<string, string>;
  pageParam?: string;
  itemName?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const url = (p: number) => base + '?' + new URLSearchParams({ ...query, [pageParam]: String(p) });
  return (
    <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>
        {total} {total === 1 ? itemName : `${itemName}s`} · Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Button variant="outline" size="sm" asChild>
            <Link href={url(page - 1)}>
              <ArrowLeft />
              Previous
            </Link>
          </Button>
        )}
        {page < pages && (
          <Button variant="outline" size="sm" asChild>
            <Link href={url(page + 1)}>
              Next
              <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
export function pageNumber(value?: string) {
  return Math.max(1, Math.min(100000, Number.parseInt(value ?? '1', 10) || 1));
}
export function Status({ value }: { value: string }) {
  return (
    <span
      className={
        'badge ' +
        (value === 'open' || value === 'active'
          ? 'bg-emerald-50 text-emerald-800'
          : value === 'cancelled'
            ? 'bg-red-50 text-red-700'
            : 'bg-secondary text-primary')
      }
    >
      {value.replaceAll('_', ' ')}
    </span>
  );
}
