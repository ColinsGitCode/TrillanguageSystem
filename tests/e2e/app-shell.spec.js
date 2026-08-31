const { test, expect } = require('@playwright/test');

test.describe('React root shell', () => {
  test('root is the only Cards Factory route and legacy entries stay retired', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Cards Factory/);
    await expect(page.getByTestId('react-cards-factory')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cards Factory' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'Cards Factory' })).toHaveAttribute('aria-current', 'page');

    const knowledgeResponse = await request.get('/knowledge');
    expect(knowledgeResponse.status()).toBe(200);

    for (const path of ['/__rr-poc', '/index.html', '/dashboard.html', '/knowledge-hub.html', '/knowledge-ops.html']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });

  test('system theme resolves after hydration and explicit choice persists', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('three-lans-theme-v1'))).toBe('light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('desktop navigation can collapse to icons and persists the choice', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/textbooks');
    await page.getByRole('button', { name: '收起导航' }).click();
    await expect(page.locator('.react-app-shell')).toHaveClass(/sidebar-compact/u);
    await expect(page.getByRole('link', { name: '教材课程' })).toHaveAttribute('title', '教材课程');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('three-lans-sidebar-compact-v1'))).toBe('true');
    await page.reload();
    await expect(page.locator('.react-app-shell')).toHaveClass(/sidebar-compact/u);
    await page.getByRole('button', { name: '展开导航' }).click();
    await expect(page.locator('.react-app-shell')).not.toHaveClass(/sidebar-compact/u);
  });

  test('dark semantic text tokens meet AA contrast and reduced motion is honored', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('three-lans-theme-v1', 'dark'));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/');
    const result = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const parse = (value) => {
        const node = document.createElement('span');
        node.style.color = value.trim();
        document.body.appendChild(node);
        const match = getComputedStyle(node).color.match(/[\d.]+/g).map(Number);
        node.remove();
        return match.slice(0, 3);
      };
      const luminance = (rgb) => {
        const values = rgb.map((value) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      const ratio = (a, b) => {
        const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (lighter + 0.05) / (darker + 0.05);
      };
      const surface = parse(root.getPropertyValue('--color-bg-surface'));
      return {
        primary: ratio(parse(root.getPropertyValue('--color-text-primary')), surface),
        secondary: ratio(parse(root.getPropertyValue('--color-text-secondary')), surface),
        transition: getComputedStyle(document.querySelector('.icon-button')).transitionDuration,
      };
    });
    expect(result.primary).toBeGreaterThanOrEqual(4.5);
    expect(result.secondary).toBeGreaterThanOrEqual(4.5);
    expect(Number.parseFloat(result.transition || '0')).toBeLessThanOrEqual(0.00001);
  });

  test('health endpoint has one React owner', async ({ page }) => {
    let count = 0;
    await page.route('**/api/health', async (route) => {
      count += 1;
      await route.continue();
    });
    await page.goto('/');
    await expect.poll(() => count).toBe(1);
    await page.waitForTimeout(500);
    expect(count).toBe(1);
  });

  test('reports privacy-safe real-user route performance without page content', async ({ page }) => {
    const batches = [];
    await page.route('**/api/ui-performance', async (route) => {
      batches.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, accepted: 1 }),
      });
    });
    await page.goto('/');
    await page.getByRole('link', { name: '今日学习' }).click();
    await expect(page).toHaveURL(/\/learn$/u);
    await expect.poll(() => batches.flatMap((batch) => batch.metrics || [])
      .some((metric) => metric.name === 'route-transition')).toBeTruthy();
    const metrics = batches.flatMap((batch) => batch.metrics || []);
    expect(metrics.every((metric) => Object.keys(metric).every(
      (key) => ['name', 'value', 'route', 'context'].includes(key)
    ))).toBeTruthy();
    expect(JSON.stringify(batches)).not.toContain('phrase');
    expect(JSON.stringify(batches)).not.toContain('selection');
  });

  test('shell exposes the active workspace boundary without an account UI', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('workspace-mode')).toContainText('个人工作区');
    await expect(page.getByTestId('workspace-mode')).toContainText('本机访问');
    await expect(page.locator('.react-app-shell')).toHaveAttribute('data-workspace-mode', 'owner');
    await expect(page.getByTestId('workspace-access-notice')).toHaveCount(0);
  });

  test('help drawer explains page boundaries, AI sources, public status and build identity', async ({ page }) => {
    await page.route('**/api/runtime', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        workspace: {
          version: 1,
          mode: 'owner',
          label: '个人工作区',
          access: 'read-write',
          exposure: 'local',
          protection: 'local-only',
          workspaceId: null,
          retentionHours: null,
          capabilities: {
            read: true,
            write: true,
            highCostOperations: true,
            durableHistory: true,
            ownerData: true,
          },
        },
        build: {
          version: '2.3.4',
          commit: 'abcdef0123456789abcdef0123456789abcdef01',
          builtAtUtc: '2026-07-30T08:00:00.000Z',
        },
        support: { feedbackUrl: 'https://support.example.com/three-lans' },
        serverTimeUtc: '2026-07-30T08:00:00.000Z',
      }),
    }));
    await page.route('**/api/health', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'healthy',
        services: [
          { name: 'DeepSeek API', status: 'online', critical: true },
          { name: 'Japanese TTS (VOICEVOX)', status: 'degraded', critical: false },
        ],
        system: { overallStatus: 'healthy', criticalOnline: true },
      }),
    }));
    await page.goto('/textbooks');

    const trigger = page.getByRole('button', { name: '帮助与系统信息' });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: '帮助与系统信息' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('教材英日原文与官方音频来自用户提供');
    await expect(drawer).toContainText('DeepSeek 生成');
    await expect(drawer).toContainText('英语使用 Kokoro');
    await expect(drawer).toContainText('AI 卡片生成');
    await expect(drawer).toContainText('日语朗读');
    await expect(drawer).toContainText('2.3.4');
    await expect(drawer).toContainText('abcdef012345');
    await expect(drawer.getByRole('link', { name: /提交问题/ })).toHaveAttribute(
      'href',
      'https://support.example.com/three-lans'
    );
  });

  test('help drawer traps focus, closes on Escape and restores the trigger', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '帮助与系统信息' });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: '帮助与系统信息' });
    const close = page.getByRole('button', { name: '关闭帮助与系统信息' });
    await expect(close).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: '复制诊断信息' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('read-only sandbox state is explicit before a user attempts a mutation', async ({ page }) => {
    await page.route('**/api/runtime', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        workspace: {
          version: 1,
          mode: 'sandbox',
          label: '体验沙箱',
          access: 'read-only',
          exposure: 'public',
          protection: 'dedicated-process-storage',
          workspaceId: 'sandbox_demo',
          retentionHours: 24,
          expiresAtUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          resetSupported: true,
          capabilities: {
            read: true,
            write: false,
            highCostOperations: false,
            durableHistory: false,
            ownerData: false,
          },
        },
        sandbox: {
          expiresAtUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          resetSupported: true,
          quota: {
            resetAtUtc: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            categories: {
              generation: { used: 0, limit: 2, remaining: 2 },
              ocr: { used: 0, limit: 5, remaining: 5 },
              tts: { used: 0, limit: 20, remaining: 20 },
            },
            storage: {
              usedBytes: 1024,
              limitBytes: 67108864,
              remainingBytes: 67107840,
            },
          },
        },
        build: { version: '1.0.0', commit: null, builtAtUtc: null },
        serverTimeUtc: new Date().toISOString(),
      }),
    }));
    await page.route('**/api/sandbox/reset', async (route) => {
      expect(route.request().headers()['x-sandbox-action']).toBe('reset');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, reset: true, reload: '/?reset=1' }),
      });
    });
    await page.goto('/');
    await expect(page.getByTestId('workspace-mode')).toContainText('体验沙箱');
    await expect(page.getByTestId('workspace-mode')).toContainText('只读');
    await expect(page.getByTestId('workspace-access-notice')).toContainText('当前是只读体验沙箱');
    await expect(page.getByTestId('workspace-access-notice')).toContainText('生成、图片识别和即时朗读未开放');
    await expect(page.locator('.react-app-shell')).toHaveAttribute('data-workspace-access', 'read-only');

    await page.getByRole('button', { name: '重置体验数据' }).click();
    const dialog = page.getByRole('alertdialog', { name: '重置当前体验沙箱？' });
    await expect(dialog).toContainText('个人工作区不受影响');
    await dialog.getByRole('button', { name: '重置体验数据' }).click();
    await expect(page).toHaveURL(/\?reset=1$/u);
  });

  test('writable sandbox exposes only the high-cost quotas that are actually enabled', async ({ page }) => {
    const expiresAtUtc = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await page.route('**/api/runtime', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        workspace: {
          version: 1,
          mode: 'sandbox',
          label: '体验沙箱',
          access: 'read-write',
          exposure: 'public',
          protection: 'dedicated-process-storage',
          workspaceId: 'sandbox_writable',
          retentionHours: 1,
          expiresAtUtc,
          resetSupported: true,
          capabilities: {
            read: true,
            write: true,
            highCostOperations: true,
            durableHistory: false,
            ownerData: false,
          },
        },
        sandbox: {
          expiresAtUtc,
          resetSupported: true,
          quota: {
            resetAtUtc: expiresAtUtc,
            categories: {
              generation: { used: 1, limit: 2, remaining: 1 },
              ocr: { used: 3, limit: 5, remaining: 2 },
              tts: { used: 12, limit: 20, remaining: 8 },
            },
            storage: {
              usedBytes: 4096,
              limitBytes: 67108864,
              remainingBytes: 67104768,
            },
          },
        },
        build: { version: '1.0.0', commit: null, builtAtUtc: null },
        serverTimeUtc: new Date().toISOString(),
      }),
    }));

    await page.goto('/');
    const notice = page.getByTestId('workspace-access-notice');
    await expect(notice).toContainText('生成 1 次');
    await expect(notice).toContainText('识别 2 次');
    await expect(notice).toContainText('朗读 8 次');
    await expect(notice).not.toContainText('未开放');
    await expect(page.locator('.react-app-shell')).toHaveAttribute('data-workspace-access', 'read-write');
  });

  test('turns a sandbox quota response into a persistent recovery state', async ({ page }) => {
    const expiresAtUtc = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await page.route('**/api/runtime', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        workspace: {
          version: 1,
          mode: 'sandbox',
          label: '体验沙箱',
          access: 'read-write',
          exposure: 'public',
          protection: 'dedicated-process-storage',
          workspaceId: 'sandbox_quota',
          retentionHours: 1,
          expiresAtUtc,
          resetSupported: true,
          capabilities: {
            read: true,
            write: true,
            highCostOperations: true,
            durableHistory: false,
            ownerData: false,
          },
        },
        sandbox: {
          expiresAtUtc,
          resetSupported: true,
          quota: {
            resetAtUtc: expiresAtUtc,
            categories: {
              generation: { used: 1, limit: 2, remaining: 1 },
              ocr: { used: 0, limit: 5, remaining: 5 },
              tts: { used: 0, limit: 20, remaining: 20 },
            },
            storage: {
              usedBytes: 4096,
              limitBytes: 67108864,
              remainingBytes: 67104768,
            },
          },
        },
        build: { version: '1.0.0', commit: null, builtAtUtc: null },
        serverTimeUtc: new Date().toISOString(),
      }),
    }));
    await page.route('**/api/generation-jobs', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: '当前体验沙箱的生成额度已用完。',
          code: 'SANDBOX_QUOTA_EXCEEDED',
          details: { category: 'generation' },
        }),
      });
    });
    await page.goto('/');
    await page.getByTestId('factory-composer-trigger').click();
    await page.getByTestId('react-phrase-input').fill('quota feedback');
    await page.getByTestId('react-generate-button').click();
    const banner = page.getByTestId('sandbox-limit-banner');
    await expect(banner).toContainText('当前体验额度已用完');
    await expect(banner).toContainText('当前体验沙箱的生成额度已用完');
    await banner.getByRole('button', { name: '重置体验数据' }).click();
    await expect(page.getByRole('alertdialog', { name: '重置当前体验沙箱？' })).toBeVisible();
  });

  test('typed shell feedback and activity survive navigation without taking domain ownership', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '后台活动' });
    await expect(trigger).toBeVisible();
    await expect(page.locator('.react-app-shell')).toHaveAttribute('data-shell-events-ready', 'true');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('three-lans:shell-feedback', {
        detail: {
          id: 'factory-job-created',
          tone: 'success',
          message: '生成任务 #42 已加入队列',
          actionLabel: '查看队列',
          actionHref: '/?queue=1&job=42',
        },
      }));
      window.dispatchEvent(new CustomEvent('three-lans:shell-activity', {
        detail: {
          id: '42',
          kind: 'generation-job',
          status: 'running',
          title: '三语卡生成',
          summary: '任务 #42 正在生成',
          href: '/?queue=1&job=42',
        },
      }));
    });

    await expect(page.getByTestId('shell-feedback')).toContainText('生成任务 #42 已加入队列');
    await expect(trigger).toContainText('1');
    await expect(trigger).toHaveAttribute('data-activity-tone', 'active');
    await trigger.click();
    await expect(page.getByRole('dialog', { name: '活动中心' })).toContainText('三语卡生成');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '活动中心' })).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.reload();
    await page.getByRole('button', { name: '后台活动' }).click();
    await expect(page.getByRole('dialog', { name: '活动中心' })).toContainText('任务 #42 正在生成');
  });

  test('activity center restores server activity after refresh and reports partial degradation', async ({ page }) => {
    await page.route('**/api/activity?limit=30', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [{
          id: '17',
          kind: 'learning-session',
          status: 'running',
          title: '未结束的学习会话',
          summary: '本次已完成 2/5，可继续上次进度',
          href: '/learn/session',
          updatedAt: new Date().toISOString(),
          source: 'learning',
          actionLabel: '继续学习',
        }, {
          id: '23',
          kind: 'textbook-operation',
          status: 'failed',
          title: '朝の情景 · 例句语音生成',
          summary: '部分语音生成失败',
          href: '/textbooks?track=1&stage=processing&operation=23',
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          source: 'textbooks',
          actionLabel: '查看并重试',
        }],
        summary: { active: 1, needsAttention: 1, total: 2 },
        sources: [
          { id: 'generation', status: 'available' },
          { id: 'textbooks', status: 'available' },
          { id: 'learning', status: 'available' },
          { id: 'knowledge', status: 'degraded' },
        ],
        generatedAtUtc: new Date().toISOString(),
      }),
    }));
    await page.goto('/');
    const activityTrigger = page.getByRole('button', { name: '后台活动' });
    await expect(activityTrigger).toHaveAttribute('data-activity-tone', 'attention');
    await expect(activityTrigger).toContainText('1');
    const recovery = page.getByTestId('recovery-banner');
    // The running session is ongoing work carried by the activity centre, so
    // only the failed operation is a recovery case.
    await expect(recovery).toContainText('有一项后台任务需要处理');
    await expect(recovery).toContainText('部分语音生成失败');
    await expect(recovery.getByRole('link', { name: '查看并重试' })).toHaveAttribute(
      'href',
      '/textbooks?track=1&stage=processing&operation=23'
    );
    await expect(recovery.getByRole('button', { name: '查看全部' })).toHaveCount(0);
    await page.getByRole('button', { name: '后台活动' }).click();
    const drawer = page.getByRole('dialog', { name: '活动中心' });
    await expect(drawer).toContainText('未结束的学习会话');
    await expect(drawer).toContainText('部分状态暂时无法同步');
    await page.reload();
    await expect(page.getByTestId('recovery-banner')).toContainText('部分语音生成失败');
    await page.getByRole('button', { name: '后台活动' }).click();
    const restoredDrawer = page.getByRole('dialog', { name: '活动中心' });
    await expect(restoredDrawer).toContainText('本次已完成 2/5');
    await expect(restoredDrawer).toContainText('教材课程 · 失败');
    await restoredDrawer.getByRole('link', { name: '继续学习' }).click();
    await expect(restoredDrawer).toBeHidden();
    await expect(page).toHaveURL(/\/learn\/session$/u);
  });

  test('activity center groups cross-domain pending work and avoids repeating page-owned recovery', async ({ page }) => {
    await page.route('**/api/activity?limit=30', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [{
          id: '12:4',
          kind: 'textbook-review',
          status: 'needs_attention',
          title: '朝の情景 · 待校对',
          summary: '2 条需重点检查，另有 7 条待确认',
          href: '/textbooks?track=12&stage=review',
          updatedAt: '2026-07-30T12:04:00.000Z',
          source: 'textbooks',
          actionLabel: '继续校对',
        }, {
          id: 'open',
          kind: 'knowledge-resolution',
          status: 'needs_attention',
          title: '3 个知识点待确认',
          summary: '最近待确认：はし。未经人工确认的候选不会进入正式知识点',
          href: '/knowledge?mode=resolution&case=31',
          updatedAt: '2026-07-30T12:03:00.000Z',
          source: 'knowledge',
          actionLabel: '开始确认',
        }, {
          id: '42',
          kind: 'generation-job',
          status: 'queued',
          title: '三语卡片生成',
          summary: '任务 #42 正在等待生成',
          href: '/?queue=1&job=42',
          updatedAt: '2026-07-30T12:02:00.000Z',
          source: 'generation',
          actionLabel: '查看任务',
        }],
        summary: { active: 1, needsAttention: 2, total: 3 },
        sources: [
          { id: 'generation', status: 'available' },
          { id: 'textbooks', status: 'available' },
          { id: 'learning', status: 'available' },
          { id: 'knowledge', status: 'available' },
        ],
        generatedAtUtc: '2026-07-30T12:05:00.000Z',
      }),
    }));

    await page.goto('/learn/history');
    await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '后台活动' }).locator('span')).toHaveText('2');
    await page.getByRole('button', { name: '后台活动' }).click();
    const drawer = page.getByRole('dialog', { name: '活动中心' });
    await expect(drawer.getByTestId('activity-group-attention')).toContainText('待处理');
    await expect(drawer.getByTestId('activity-group-attention')).toContainText('朝の情景 · 待校对');
    await expect(drawer.getByTestId('activity-group-attention')).toContainText('3 个知识点待确认');
    await expect(drawer.getByTestId('activity-group-active')).toContainText('三语卡片生成');
    await expect(drawer.getByRole('link', { name: /继续校对/ })).toHaveAttribute(
      'href',
      '/textbooks?track=12&stage=review'
    );

    await page.goto('/knowledge');
    await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
    await page.getByRole('button', { name: '后台活动' }).click();
    const knowledgeDrawer = page.getByRole('dialog', { name: '活动中心' });
    await expect(knowledgeDrawer).toContainText('朝の情景 · 待校对');
    await expect(knowledgeDrawer).toContainText('3 个知识点待确认');
  });

  test('service degradation explains the affected capability and supports a retry', async ({ page }) => {
    let checks = 0;
    await page.route('**/api/health', (route) => {
      checks += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [{
            name: 'DeepSeek API',
            critical: true,
            status: 'offline',
            message: 'provider unavailable',
          }, {
            name: 'Storage',
            critical: true,
            status: 'online',
          }],
          system: { overallStatus: 'degraded', criticalOnline: false },
        }),
      });
    });
    await page.goto('/');
    const banner = page.getByTestId('service-degradation-banner');
    await expect(banner).toContainText('关键服务暂时不可用');
    await expect(banner).toContainText('卡片生成暂不可用');
    await expect(banner).toContainText('已有卡片、教材浏览和学习复习仍可继续');
    await banner.getByRole('button', { name: '重新检查' }).click();
    await expect.poll(() => checks).toBeGreaterThanOrEqual(2);
  });

  test('activity drawer restores focus after explicit close', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '后台活动' });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: '活动中心' });
    await expect(drawer).toBeVisible();
    await page.getByRole('button', { name: '关闭后台活动' }).click();
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('activity drawer traps keyboard focus and isolates the background', async ({ page }) => {
    await page.route('**/api/activity?limit=30', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [{
          id: 'fixture-activity',
          kind: 'generation-job',
          status: 'failed',
          title: '卡片生成失败',
          summary: '任务 #91 需要重试',
          href: '/?queue=1&job=91',
          actionLabel: '查看并重试',
          updatedAt: '2026-07-30T08:00:00.000Z',
          source: 'generation',
        }],
        summary: { active: 0, needsAttention: 1, total: 1 },
        sources: [
          { id: 'generation', status: 'available' },
          { id: 'textbooks', status: 'available' },
          { id: 'learning', status: 'available' },
          { id: 'knowledge', status: 'available' },
        ],
        generatedAtUtc: '2026-07-30T08:00:00.000Z',
      }),
    }));
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '后台活动' });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: '活动中心' });
    const close = page.getByRole('button', { name: '关闭后台活动' });
    const action = drawer.getByRole('link', { name: /查看并重试/ });
    await expect(close).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await page.keyboard.press('Shift+Tab');
    await expect(action).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  });
});
