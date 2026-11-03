import LifeOS from '../../components/LifeOS';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionUser } from '../../lib/security.mjs';
import { personalView } from '../../lib/personal-routes.mjs';

export const metadata = { title: '用户中心 · 知序 LifeOS', robots: { index: false, follow: false } };

export default async function UserPage({ searchParams }) {
  const user = await sessionUser({ cookies: await cookies() });
  if (!user) redirect('/login');
  const query = await searchParams;
  return <LifeOS initialView={personalView(query.view)} />;
}
