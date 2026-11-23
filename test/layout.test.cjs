const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withWindow } = require('@lengmoxxl/wangcai-testkit');

test('the workspace keeps a rectangular scroll clip and reserves its border width as the sidebar toggles', { timeout: 180000 }, () => withWindow('wangcai-pane-frame', {}, async ({ page }) => {
  await page.locator('#root').evaluate(root => root.style.setProperty('--wc-pane-border-width', '2px'));
  const toggle = page.getByRole('button', { name: '切换右侧栏' });
  for (const [state, radius, width] of [
    ['visible', '8px 0px 0px 8px', '2px 0px 2px 2px'],
    ['hidden', '8px', '2px'],
  ]) {
    await toggle.click();
    await page.locator('.sidebar-right').waitFor({ state });
    const style = await page.locator('.desktop-main').evaluate(main => {
      const pane = getComputedStyle(main);
      const frame = getComputedStyle(main, '::after');
      return {
        overflow: pane.overflow, clipRadius: pane.borderRadius, padding: pane.padding,
        frameRadius: frame.borderRadius, frameWidth: frame.borderWidth,
      };
    });
    assert.equal(style.overflow, 'hidden');
    assert.equal(style.clipRadius, '0px');
    assert.equal(style.frameRadius, radius);
    assert.equal(style.frameWidth, width);
    assert.equal(style.padding, style.frameWidth);
  }
}));
