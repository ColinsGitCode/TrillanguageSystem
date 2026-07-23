import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AppLayout from '@cloudscape-design/components/app-layout';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Flashbar from '@cloudscape-design/components/flashbar';
import Header from '@cloudscape-design/components/header';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Steps from '@cloudscape-design/components/steps';
import Wizard from '@cloudscape-design/components/wizard';
import './poc.css';

const stages = [
  { id: 'review', header: '人工确认', content: '检查低置信度、ruby 与英日配对。' },
  { id: 'release', header: '发布检查', content: '确认表达数量、Study Item 和音频范围。' },
  { id: 'processing', header: '后台处理', content: '查看 publish、materialize、TTS 与 sync。' },
];

function CloudscapeScene() {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  return (
    <AppLayout
      navigation={<SideNavigation activeHref="#review" header={{ href: '#', text: 'Textbook workflow' }} items={stages.map((stage) => ({ type: 'link', text: stage.header, href: `#${stage.id}` }))} />}
      tools={<Container header={<Header variant="h2">上下文</Header>}><StatusIndicator type="warning">1 项需注意</StatusIndicator></Container>}
      content={
        <SpaceBetween size="l">
          <Flashbar items={[{ type: 'info', content: 'Skill 已完成结构化，本页只负责人工确认。', dismissible: true, id: 'skill' }]} />
          <Container header={<Header variant="h1">Cloudscape candidate</Header>}>
            <Steps steps={stages.map((stage, index) => ({ status: index < activeStepIndex ? 'success' : index === activeStepIndex ? 'in-progress' : 'pending', header: stage.header }))} />
          </Container>
          <Wizard
            activeStepIndex={activeStepIndex}
            onNavigate={({ detail }) => setActiveStepIndex(detail.requestedStepIndex)}
            onSubmit={() => undefined}
            steps={stages.map((stage) => ({ title: stage.header, content: stage.content }))}
            i18nStrings={{
              stepNumberLabel: (stepNumber) => `Step ${stepNumber}`,
              collapsedStepsLabel: (stepNumber, stepsCount) => `Step ${stepNumber} of ${stepsCount}`,
              skipToButtonLabel: (step, stepNumber) => `Skip to ${step.title}, Step ${stepNumber}`,
              navigationAriaLabel: 'Workflow stages',
              cancelButton: '取消',
              previousButton: '上一步',
              nextButton: '下一步',
              submitButton: '执行',
              optional: '可选'
            }}
          />
          <Button>POC action</Button>
        </SpaceBetween>
      }
    />
  );
}

function ThreeLansScene() {
  return (
    <section className="self-scene">
      <header><p>THREE LANS WORKFLOW</p><h1>自研原语候选</h1><span>已保存</span></header>
      <nav aria-label="Workflow stages">{stages.map((stage, index) => <button className={index === 0 ? 'active' : ''} key={stage.id}>{stage.header}</button>)}</nav>
      <div className="self-grid">
        <aside>异常任务列表</aside>
        <main><h2>人工确认</h2><p>保留舒适阅读区与 Three LANS 语言颜色。</p></main>
        <aside>来源与检查</aside>
      </div>
    </section>
  );
}

function App() {
  return <main><CloudscapeScene /><ThreeLansScene /></main>;
}

createRoot(document.getElementById('root')).render(<App />);
