export function ContextTools({ title = '上下文', sections, children }: {
  title?: string;
  sections?: Array<{ label: string; value: React.ReactNode }>;
  children?: React.ReactNode;
}) {
  return (
    <aside className="workflow-context-tools" aria-label={title}>
      <header><p className="eyebrow">CONTEXT TOOLS</p><h2>{title}</h2></header>
      {sections?.map((section) => <section key={section.label}><h3>{section.label}</h3><div>{section.value}</div></section>)}
      {children}
    </aside>
  );
}
