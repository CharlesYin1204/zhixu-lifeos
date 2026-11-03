import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import UserLogin from '../../components/UserLogin';
import { settings } from '../../lib/db.mjs';
import { sessionUser } from '../../lib/security.mjs';

export const metadata = { title: '用户登录 · 知序 LifeOS' };

export default async function LoginPage({ searchParams }) {
  const user = await sessionUser({ cookies: await cookies() });
  if (user) redirect('/user');
  const [site, query] = await Promise.all([settings(), searchParams]);
  return <UserLogin siteName={site.siteName} supportContact={site.supportContact} initialRegister={query.mode === 'register'} />;
}
