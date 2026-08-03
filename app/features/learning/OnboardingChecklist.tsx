import { Check, Circle, ListChecks, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { onboardingApi } from '../../lib/onboarding/onboarding';

const DISMISSED_KEY = 'three-lans-onboarding-dismissed-v1';

export function OnboardingChecklist() {
  const [hydrated, setHydrated] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const onboardingQuery = useQuery({
    queryKey: ['onboarding'],
    queryFn: onboardingApi.get,
    enabled: hydrated && !dismissed,
    staleTime: 5_000,
  });

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === 'true');
    setHydrated(true);
  }, []);

  const state = onboardingQuery.data;
  if (!hydrated || dismissed || !state || state.completed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  };

  return (
    <section className="surface learning-onboarding" data-testid="learning-onboarding" aria-labelledby="learning-onboarding-title">
      <header>
        <div>
          <p className="eyebrow">首次学习闭环</p>
          <h2 id="learning-onboarding-title"><ListChecks aria-hidden="true" /> 完成第一次真实学习</h2>
          <p>进度完全来自当前工作区的卡片、计划、队列和评分记录。</p>
        </div>
        <button className="icon-button" type="button" aria-label="暂不显示首次学习清单" title="暂不显示" onClick={dismiss}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="learning-onboarding-progress" aria-label={`首次学习进度 ${state.completedCount} / ${state.total}`}>
        <span style={{ width: `${(state.completedCount / state.total) * 100}%` }} />
      </div>
      <ol>
        {state.steps.map((step) => (
          <li className={step.complete ? 'is-complete' : step.id === state.nextStep?.id ? 'is-next' : ''} key={step.id}>
            {step.complete ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
            <div><strong>{step.title}</strong><span>{step.description}</span></div>
          </li>
        ))}
      </ol>
      {state.nextStep && (
        <footer>
          <span>下一步：{state.nextStep.title}</span>
          <Link className="learning-primary-button" to={state.nextStep.href}>{state.nextStep.actionLabel}</Link>
        </footer>
      )}
    </section>
  );
}
