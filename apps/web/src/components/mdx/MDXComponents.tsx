import { Aside } from "@/components/mdx/Aside";
import { Callout } from "@/components/mdx/Callout";
import CodeBlock from "@/components/mdx/CodeBlock";
import { MdxCard } from "@/components/mdx/MdxCard";
import React, { ReactNode } from "react";

interface HeadingProps {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  className: string;
  children: ReactNode;
}

const Heading: React.FC<HeadingProps> = ({ level, className, children }) => {
  const HeadingTag = `h${level}` as keyof React.ElementType;
  const headingId = children?.toString() ?? "";

  return React.createElement(HeadingTag, { id: headingId, className }, children);
};

interface MDXComponentsProps {
  [key: string]: React.FC<any>;
}

const MDXComponents: MDXComponentsProps = {
  h1: (props) => <Heading level={1} className="mt-8 mb-6 text-4xl font-bold" {...props} />,
  h2: (props) => (
    <Heading
      level={2}
      className="mt-8 mb-6 border-b-2 border-gray-200 pb-2 text-3xl font-semibold"
      {...props}
    />
  ),
  h3: (props) => <Heading level={3} className="mt-6 mb-4 text-2xl font-semibold" {...props} />,
  h4: (props) => <Heading level={4} className="mt-6 mb-4 text-xl font-semibold" {...props} />,
  h5: (props) => <Heading level={5} className="mt-6 mb-4 text-lg font-semibold" {...props} />,
  h6: (props) => <Heading level={6} className="mt-6 mb-4 text-base font-semibold" {...props} />,
  hr: (props) => <hr className="my-8 border-t border-gray-200" {...props} />,
  p: (props) => <p className="my-3 leading-relaxed text-gray-700 dark:text-gray-300" {...props} />,
  a: (props) => (
    <a
      className="text-blue-600 underline underline-offset-4 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      target="_blank"
      {...props}
    />
  ),
  ul: (props) => <ul className="mt-0 mb-6 list-disc pl-6" {...props} />,
  ol: (props) => <ol className="mt-0 mb-6 list-decimal pl-6" {...props} />,
  li: (props) => <li className="mb-3 text-gray-700 dark:text-gray-300" {...props} />,
  code: (props) => (
    <span className="rounded bg-gray-100 px-2 py-1 font-mono text-sm dark:bg-gray-700" {...props} />
  ),
  pre: (props) => {
    const preStyles = "rounded-lg p-3 overflow-x-auto my-4 bg-gray-100 dark:bg-gray-800";
    return <CodeBlock {...props} className={`${props.className || ""} ${preStyles}`.trim()} />;
  },
  blockquote: (props) => (
    <blockquote
      className="my-6 border-l-4 pl-6 text-gray-600 italic dark:text-gray-400"
      {...props}
    />
  ),
  img: (props) => <img className="my-6 rounded-lg border-2 border-gray-200" {...props} />,
  strong: (props) => <strong className="font-bold" {...props} />,
  table: (props) => (
    <div className="my-3 overflow-x-auto">
      <table className="m-0 w-full table-fixed border-collapse overflow-hidden" {...props} />
    </div>
  ),
  thead: (props) => <thead {...props} />,
  tbody: (props) => <tbody {...props} />,
  tr: (props) => <tr {...props} />,
  th: (props) => (
    <th
      className="relative box-border min-w-[1em] border border-gray-200 bg-gray-50 px-2 py-1.5 text-left align-top font-bold dark:border-gray-700 dark:bg-gray-800 [[align=center]]:text-center [[align=right]]:text-right"
      {...props}
    />
  ),
  td: (props) => (
    <td
      className="relative box-border min-w-[1em] border border-gray-200 px-2 py-1.5 align-top dark:border-gray-700 [[align=center]]:text-center [[align=right]]:text-right"
      {...props}
    />
  ),
  Aside,
  Callout,
  Card: MdxCard,
};

export default MDXComponents;
