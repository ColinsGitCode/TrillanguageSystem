import { requestJson } from '../api/client';

export type OnboardingStep = {
  id: 'content' | 'plan' | 'queue' | 'review';
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  complete: boolean;
};

export type OnboardingState = {
  success: true;
  version: number;
  completed: boolean;
  completedCount: number;
  total: number;
  steps: OnboardingStep[];
  nextStep: OnboardingStep | null;
};

export const onboardingApi = {
  get: () => requestJson<OnboardingState>('/api/onboarding'),
};
