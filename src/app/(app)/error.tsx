'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="panel text-center">
      <h2 className="section-title">We couldn’t load this page</h2>
      <p className="my-4 text-sm text-muted-foreground">
        Check your connection and try again. Your saved records are unchanged.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
