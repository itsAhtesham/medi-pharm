import { redirect } from 'next/navigation';
import { actor } from '@/server/session';
export default async function Home() {
  redirect((await actor()) ? '/dashboard' : '/login');
}
