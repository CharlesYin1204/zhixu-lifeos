import './globals.css';
import './media.css';
import 'katex/dist/katex.min.css';

export const metadata = {
  title: '知序 LifeOS · 让学习与生活有序生长',
  description: '你的个人学习与生活 AI 工作台。多 Agent 协作、学习计划、习惯养成、知识库与插件，一处管理。',
  applicationName: '知序 LifeOS',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#12695b' };

export default function RootLayout({ children }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
