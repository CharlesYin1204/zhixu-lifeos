'use client';

import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// Model replies commonly use TeX bracket delimiters. Preserve literal code samples.
export function normalizeMath(content) {
  return String(content || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g).map((part,index) => index % 2 ? part : part
    .replace(/\\\[([\s\S]*?)\\\]/g, (_,math) => `\n\n$$\n${math.trim()}\n$$\n\n`)
    .replace(/\\\(([^\n]*?)\\\)/g, (_,math) => `$${math.trim()}$`)).join('');
}

export default function MediaAnswer({ children }) {
  return <div className="media-rich-answer"><Markdown
    remarkPlugins={[remarkMath]}
    rehypePlugins={[[rehypeKatex,{trust:false,strict:'ignore',maxExpand:1000}]]}
    skipHtml
    disallowedElements={['img','script','iframe','style','object','embed']}
    components={{a:({node,...props})=><a {...props} target="_blank" rel="noopener noreferrer"/>}}
  >{normalizeMath(children)}</Markdown></div>;
}
