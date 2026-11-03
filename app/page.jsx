import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import LandingPage from '../components/LandingPage';
import { entities } from '../lib/db.mjs';
import { publicSettings } from '../lib/site-settings.mjs';
import { sessionUser } from '../lib/security.mjs';
import { PERSONAL_VIEWS, personalHref } from '../lib/personal-routes.mjs';

const ADMIN_SECTIONS = new Set(['overview', 'users', 'models', 'media', 'agents', 'runs', 'usage', 'plugins', 'plans', 'orders', 'payment', 'apk', 'settings', 'audit', 'account']);

export default async function Home({ searchParams }) {
  const query = await searchParams;
  if (query.view === 'admin') {
    const section = query.section || query.tab;
    redirect(ADMIN_SECTIONS.has(section) ? `/admin?section=${section}` : '/admin');
  }
  if (query.view === 'login') redirect('/login');
  if (PERSONAL_VIEWS.includes(query.view)) redirect(personalHref(query.view, typeof query.kind === 'string' ? query.kind : ''));
  const [site, plans, user] = await Promise.all([
    publicSettings(), entities('plan'), sessionUser({ cookies: await cookies() }),
  ]);
  const published = site.apk?.published || site.apk || {};
  return <LandingPage siteName={site.siteName} supportContact={site.supportContact}
    authenticated={Boolean(user)} plans={plans.map(({id,name,price,days,credits,features,description}) => ({id,name,price,days,credits,features,description}))}
    apk={{versionName:published.versionName,downloadUrl:published.downloadUrl,size:published.size}} />;
}
