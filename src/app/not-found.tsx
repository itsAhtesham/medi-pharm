import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="p-16 text-center">
      <h1 className="page-title">Record not found</h1>
      <p className="my-4">This record is unavailable or the link is incorrect.</p>
      <Link href="/dashboard" className="text-primary underline">
        Return to dashboard
      </Link>
    </main>
  );
}
