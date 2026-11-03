export const PERSONAL_VIEWS = ['user', 'overview', 'ai', 'media', 'agents', 'learning', 'life', 'knowledge', 'plugins', 'membership'];
export const personalView = value => PERSONAL_VIEWS.includes(value) ? value : 'user';
export function personalHref(view = 'user', kind = '') {
  const target = personalView(view);
  const query = new URLSearchParams();
  if (target !== 'user') query.set('view', target);
  if (kind) query.set('kind', kind);
  return `/user${query.size ? `?${query}` : ''}`;
}
