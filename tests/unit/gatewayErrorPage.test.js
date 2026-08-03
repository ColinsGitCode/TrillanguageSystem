'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  gatewayErrorDescriptor,
  renderGatewayErrorPage,
  safeSupportUrl,
} = require('../../services/sandbox/gatewayErrorPage');

test.describe('public sandbox gateway error page', () => {
  test.it('renders a recoverable capacity state without account or owner fallback', () => {
    const descriptor = gatewayErrorDescriptor({
      status: 503,
      code: 'SANDBOX_CAPACITY_FULL',
    });
    assert.equal(descriptor.status, 503);
    assert.equal(descriptor.retryAfterSeconds, 30);
    const html = renderGatewayErrorPage({ status: 503 }, {
      feedbackUrl: 'https://support.example.com/three-lans',
    });
    assert.match(html, /体验空间暂时已满/u);
    assert.match(html, /个人工作区没有被连接或共享/u);
    assert.match(html, /prefers-color-scheme:dark/u);
    assert.match(html, /href="https:\/\/support\.example\.com\/three-lans"/u);
    assert.doesNotMatch(html, /onclick=/u);
  });

  test.it('does not interpolate unsafe support URLs', () => {
    assert.equal(safeSupportUrl('javascript:alert(1)'), null);
    const html = renderGatewayErrorPage({
      code: '<script>alert(1)</script>',
    }, {
      feedbackUrl: 'javascript:alert(1)',
    });
    assert.doesNotMatch(html, /<script>alert/u);
    assert.doesNotMatch(html, /提交问题/u);
  });
});
