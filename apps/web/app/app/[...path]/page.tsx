import { redirect } from 'next/navigation';
export default async function LegacyRoute({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path[0] === 'meetings' && path[1])
    redirect(`/app?view=meetings&meeting=${encodeURIComponent(path[1])}`);
  if (path[0] === 'spaces' && path[1]) redirect(`/app?space=${encodeURIComponent(path[1])}`);
  if (path[0] === 'messages') redirect('/app?view=messages');
  redirect('/app');
}
