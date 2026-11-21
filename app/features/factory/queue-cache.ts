import type { QueryClient } from '@tanstack/react-query';
import type { GenerationJob } from './types';

export function rememberSubmittedJob(client: QueryClient, job: GenerationJob) {
  client.setQueryData<{ jobs: GenerationJob[] }>(['queue', 'jobs'], previous => ({
    jobs: [job, ...(previous?.jobs || []).filter(item => item.id !== job.id)].slice(0, 30),
  }));
}
