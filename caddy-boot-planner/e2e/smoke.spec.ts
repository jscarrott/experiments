import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke tests. The geometry is covered properly by the unit tests, so these only
 * have to answer the questions unit tests cannot: does the page boot, does WebGL
 * actually paint something, and do the UI and the scene stay in step.
 */

/** Read state out of the app rather than scraping the DOM for it. */
async function planner(page: Page) {
  return page.evaluate(() => {
    const p = (window as any).__planner;
    return {
      boxCount: p.state.layout.boxes.length,
      meshCount: p.boxMeshes.size,
      errors: p.state.analysis.fit.filter((i: any) => i.severity === 'error').length,
      sceneChildren: p.viewer.scene.children.length,
    };
  });
}

test.beforeEach(async ({ page }) => {
  // Start from a clean slate so a previous run's autosave cannot affect the test.
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* storage blocked; the app copes */
    }
  });
});

test('the page loads and the canvas paints a non-blank frame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  // WebGL context is live, not a fallback.
  const hasContext = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  });
  expect(hasContext).toBe(true);

  // The frame actually has content: a screenshot of a blank canvas compresses to
  // almost nothing, so a real render is comfortably larger.
  const shot = await page.locator('canvas').screenshot();
  expect(shot.byteLength).toBeGreaterThan
    (5000);

  expect(errors).toEqual([]);
});

test('adding a box from the catalogue puts it in the scene', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  expect((await planner(page)).boxCount).toBe(0);
  await expect(page.locator('.panel__empty').first()).toContainText('Nothing loaded yet');

  await page.locator('.catalogue__item').first().click();

  const after = await planner(page);
  expect(after.boxCount).toBe(1);
  expect(after.meshCount).toBe(1);

  // And the loaded list reflects it.
  await expect(page.locator('.loaded__item')).toHaveCount(1);
});

test('an oversized box is reported as not fitting', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  // Add a box, then override its width to something that cannot go between the arches.
  await page.locator('.catalogue__item').first().click();
  await page.evaluate(() => {
    const p = (window as any).__planner;
    const box = p.state.layout.boxes[0];
    p.state.updateBox(box.id, { overrides: { width: 1500 } });
  });

  expect((await planner(page)).errors).toBeGreaterThan(0);
  await expect(page.locator('.warnings__item--error').first()).toContainText('wheel arches');
});

test('the net reports a short box between two tall ones as bridged', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  const result = await page.evaluate(() => {
    const p = (window as any).__planner;
    const state = p.state;

    // Two full-width 700 mm stacks front and back with a 200 mm box between them,
    // and the net clipped to the four corner eyes. This is the classic case: it
    // looks strapped down and the middle box is held by nothing.
    const front = state.addBox('custom');
    const middle = state.addBox('custom');
    const back = state.addBox('custom');

    const wide = { width: 1100, depth: 300, height: 700 };
    state.updateBox(front.id, { x: 0, y: 200, contentsKg: 10, overrides: wide });
    state.updateBox(middle.id, {
      x: 0,
      y: 550,
      contentsKg: 15,
      overrides: { width: 1100, depth: 300, height: 200 },
    });
    state.updateBox(back.id, { x: 0, y: 900, contentsKg: 10, overrides: wide });

    state.setNetEnabled(true);
    state.updateNet(state.layout.nets[0].id, {
      anchorIds: ['eye-fl', 'eye-fr', 'eye-rl', 'eye-rr'],
    });

    const net = state.analysis.netResults[0];
    return {
      bridgedIds: [...net.bridgedBoxIds],
      heldIds: [...net.heldBoxIds],
      middleId: middle.id,
      frontId: front.id,
      backId: back.id,
    };
  });

  expect(result.heldIds).toContain(result.frontId);
  expect(result.heldIds).toContain(result.backId);
  expect(result.bridgedIds).toContain(result.middleId);
  expect(result.heldIds).not.toContain(result.middleId);

  // And it says so in words, which is the part that makes it useful.
  await expect(page.locator('.warnings__item', { hasText: 'bridges' })).toHaveCount(1);
});

test('a cord between the mid anchors does catch a low box sitting over them', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  // Same load, but with the net on all six eyes. The mid pair sits under the short
  // box, so a cord between them bears on it and it is no longer unrestrained.
  const result = await page.evaluate(() => {
    const p = (window as any).__planner;
    const state = p.state;

    const front = state.addBox('custom');
    const middle = state.addBox('custom');
    const back = state.addBox('custom');

    const wide = { width: 1100, depth: 300, height: 700 };
    state.updateBox(front.id, { x: 0, y: 200, contentsKg: 10, overrides: wide });
    state.updateBox(middle.id, {
      x: 0,
      y: 550,
      contentsKg: 15,
      overrides: { width: 1100, depth: 300, height: 200 },
    });
    state.updateBox(back.id, { x: 0, y: 900, contentsKg: 10, overrides: wide });

    state.setNetEnabled(true);

    const net = state.analysis.netResults[0];
    return { heldIds: [...net.heldBoxIds], middleId: middle.id };
  });

  expect(result.heldIds).toContain(result.middleId);
});

test('calibrating a dimension marks it as measured and re-runs the checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();

  // Floor length ships as "calculated" — it is derived from a load volume.
  const lengthField = page.locator('.calibrate__field').first();
  await expect(lengthField.locator('.calibrate__tag')).toHaveText('calculated');

  await lengthField.locator('input').fill('1450');
  await lengthField.locator('input').blur();

  await expect(lengthField.locator('.calibrate__tag')).toHaveText('you measured');

  const floorLength = await page.evaluate(
    () => (window as any).__planner.state.layout.vehicle.floorLength.value,
  );
  expect(floorLength).toBe(1450);
});
