import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const PROJECT_ID = 'demo-bsm-client-app';
const credentialsPath = process.env.BSM_UAT_CREDENTIALS_FILE;
if (!credentialsPath) throw new Error('BSM_UAT_CREDENTIALS_FILE is required for mobile responsiveness UAT.');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Mobile responsiveness UAT requires Auth and Firestore emulators.');
}
if ([process.env.GOOGLE_CLOUD_PROJECT, process.env.GCLOUD_PROJECT, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID].filter(Boolean).some((value) => value !== PROJECT_ID)) {
  throw new Error(`Mobile responsiveness UAT is restricted to ${PROJECT_ID}.`);
}

const fixture = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const admin = fixture.users?.find((user) => user.key === 'admin');
const selectorAdmin = fixture.users?.find((user) => user.key === 'selectorAdmin');
const workspace = fixture.organizations?.find((organization) => organization.id === fixture.organizationId);
const longClient = fixture.clients?.mobileLong;
const longDeal = fixture.deals?.mobileLong;
const partialSale = fixture.sales?.mobilePartial;
if (!admin?.email || !admin.password || !selectorAdmin?.email || !selectorAdmin.password || !workspace || !longClient || !longDeal || !partialSale) {
  throw new Error('The generated mobile UAT fixture is incomplete. Run npm run uat:seed first.');
}

const routes = [
  { name: 'Dashboard', path: '/', heading: 'Dashboard', mobileAction: 'Add Lead', desktopAction: 'Add Lead' },
  { name: 'Leads', path: '/leads', heading: 'Leads & Prospects', mobileAction: 'Add Lead', desktopAction: 'Add Lead' },
  { name: 'Clients', path: '/clients', heading: 'Clients', mobileAction: 'Add Client', desktopAction: 'Add Client' },
  { name: 'Pipeline', path: '/pipeline', heading: 'Sales Pipeline', mobileAction: 'Add Deal', desktopAction: 'Add Deal' },
  { name: 'Tasks', path: '/tasks', heading: 'Tasks & Follow-ups', mobileAction: 'Add Task', desktopAction: 'Add Task' },
  { name: 'Catalog', path: '/catalog', heading: 'Catalog', mobileAction: 'Add Item', desktopAction: 'Add Item' },
  { name: 'Sales', path: '/sales', heading: 'Sales Log', action: 'Record Sale' },
  { name: 'Reports', path: '/reports', heading: 'Reports & Analytics', action: 'Customize Cards' },
  { name: 'Settings', path: '/settings', heading: 'Settings', action: 'Save Profile' },
  { name: 'Feedback', path: '/feedback', heading: 'Feedback & Support', action: 'Submit' },
];

const phoneViewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function signIn(page, identity = admin) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Local UAT sign-in')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Local UAT email').fill(identity.email);
  await page.getByLabel('Local UAT password').fill(identity.password);
  await page.getByRole('button', { name: 'Sign in for local UAT' }).click();
  await expect.poll(async () => {
    if (await page.getByRole('heading', { name: 'Select Workspace' }).isVisible().catch(() => false)) return 'picker';
    if (await page.getByRole('heading', { name: 'Dashboard', exact: true }).isVisible().catch(() => false)) return 'dashboard';
    return 'loading';
  }, { timeout: 30_000 }).toMatch(/picker|dashboard/);
  if (await page.getByRole('heading', { name: 'Select Workspace' }).isVisible().catch(() => false)) {
    await page.getByRole('button').filter({ has: page.getByText(workspace.name, { exact: true }) }).click();
  }
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30_000 });
}

async function openRoute(page, route) {
  await page.goto(route.path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible({ timeout: 30_000 });
  const action = page.viewportSize()?.width < 768 && route.mobileAction ? route.mobileAction : route.desktopAction || route.action;
  await expect(page.getByRole('button', { name: action, exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(100);
}

async function assertPageGeometry(page, label, { mobile = false } = {}) {
  const result = await page.evaluate(({ checkTouchTargets }) => {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const visible = (element) => {
      if (!(element instanceof HTMLElement) || element.closest('[inert]')) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth;
    };
    const hasHorizontalScroller = (element) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (['auto', 'scroll'].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth + 1) return true;
      }
      return false;
    };
    const controlSelector = 'button, a[href], input, select, textarea, [role="tab"]';
    const clippedControls = [...document.querySelectorAll(controlSelector)].flatMap((element) => {
      if (!visible(element) || hasHorizontalScroller(element)) return [];
      const rect = element.getBoundingClientRect();
      if (rect.left >= -1 && rect.right <= viewportWidth + 1) return [];
      return [{
        label: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      }];
    });
    const touchSelector = [
      '.app-button',
      '.app-icon-button',
      '#mobile-navigation-trigger',
      '.mobile-page-quick-action-trigger',
      '.dashboard-mobile-quick-action-trigger',
      '.dashboard-range-trigger',
      '.dashboard-range-option',
      '.kpi-info-trigger',
      '.catalog-inline-action',
      '.task-tabs > button',
      '.settings-navigation > button',
      '.app-main-content [role="tab"]',
      '.app-main-content button[aria-label="About Pipeline Overview"]',
      '.app-main-content button[aria-controls="deal-products-services-content"]',
      '.app-main-content button[aria-controls="sale-products-services-content"]',
      '.app-main-content button[aria-controls="sale-payment-content"]',
      '.app-main-content input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])',
      '.app-main-content select',
    ].join(',');
    const undersizedTouchTargets = checkTouchTargets ? [...document.querySelectorAll(touchSelector)].flatMap((element) => {
      if (!visible(element)) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width >= 43.5 && rect.height >= 43.5) return [];
      const style = getComputedStyle(element);
      return [{
        label: element.getAttribute('aria-label') || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80),
        className: element.className,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        computedWidth: style.width,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
      }];
    }) : [];
    const header = document.querySelector('.page-header');
    const headerElements = header ? [
      header.querySelector('#mobile-navigation-trigger'),
      header.querySelector('h1'),
      header.querySelector('.mobile-page-quick-action-trigger, .dashboard-mobile-quick-action-trigger'),
    ].filter((element) => visible(element)) : [];
    const headerOverlaps = [];
    const visualRect = (element) => {
      if (element.tagName !== 'H1') return element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    for (let leftIndex = 0; leftIndex < headerElements.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < headerElements.length; rightIndex += 1) {
        const left = visualRect(headerElements[leftIndex]);
        const right = visualRect(headerElements[rightIndex]);
        if (left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top) {
          headerOverlaps.push(`${headerElements[leftIndex].tagName}:${headerElements[rightIndex].tagName}`);
        }
      }
    }
    const main = document.querySelector('.app-main-content');
    return {
      rootOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : null,
      clippedControls,
      undersizedTouchTargets,
      headerOverlaps,
    };
  }, { checkTouchTargets: mobile });

  expect(result.rootOverflow, `${label}: viewport-wide horizontal overflow`).toBeLessThanOrEqual(1);
  expect(result.mainOverflow, `${label}: main content horizontal overflow`).toBeLessThanOrEqual(1);
  expect(result.clippedControls, `${label}: controls clipped outside the viewport`).toEqual([]);
  expect(result.headerOverlaps, `${label}: page-header controls overlap`).toEqual([]);
  if (mobile) expect(result.undersizedTouchTargets, `${label}: interactive targets smaller than 44px`).toEqual([]);
}

async function assertMobileScrollableTable(table, label) {
  await expect(table).toBeVisible({ timeout: 30_000 });
  const result = await table.evaluate(async (element) => {
    const scroller = element.parentElement;
    if (!scroller) throw new Error('Table scroll container is missing.');
    const header = element.querySelector('thead');
    const row = element.querySelector('tbody > tr');
    const primaryCell = row?.querySelector('td:not(:has(input[type="checkbox"]))');
    const selectionControl = row?.querySelector('td input[type="checkbox"]');
    const finalCell = row?.querySelector('td:last-child');
    scroller.scrollLeft = 0;
    await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    const scrollerStart = scroller.getBoundingClientRect();
    const primaryStart = primaryCell?.getBoundingClientRect();
    const selectionStart = selectionControl?.getBoundingClientRect();
    const headerContentContained = header
      ? [...header.querySelectorAll('th')].every((cell) => {
        const cellRect = cell.getBoundingClientRect();
        const content = cell.querySelector('button, input, span') || cell;
        const contentRect = content.getBoundingClientRect();
        return contentRect.left >= cellRect.left - 1 && contentRect.right <= cellRect.right + 1;
      })
      : false;
    scroller.scrollLeft = scroller.scrollWidth;
    await new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    const scrollerEnd = scroller.getBoundingClientRect();
    const finalEnd = finalCell?.getBoundingClientRect();
    const actionTargets = finalCell
      ? [...finalCell.querySelectorAll('button, a[href]')].map((target) => {
        const rect = target.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
      : [];
    return {
      display: getComputedStyle(element).display,
      headerDisplay: header ? getComputedStyle(header).display : null,
      rowDisplay: row ? getComputedStyle(row).display : null,
      overflowX: getComputedStyle(scroller).overflowX,
      scrollableWidth: scroller.scrollWidth - scroller.clientWidth,
      primaryText: primaryCell?.textContent?.trim() || '',
      primaryVisibleAtStart: primaryStart
        ? primaryStart.left < scrollerStart.right && primaryStart.right > scrollerStart.left
        : false,
      selectionDoesNotOverlapPrimary: !selectionStart || !primaryStart || selectionStart.right <= primaryStart.left + 1,
      headerContentContained,
      finalVisibleAtEnd: finalEnd
        ? finalEnd.left < scrollerEnd.right + 1 && finalEnd.right <= scrollerEnd.right + 1
        : false,
      actionTargets,
    };
  });

  expect(result.display, `${label}: semantic table display`).toBe('table');
  expect(result.headerDisplay, `${label}: column headings remain visible`).toBe('table-header-group');
  expect(result.rowDisplay, `${label}: rows remain table rows`).toBe('table-row');
  expect(['auto', 'scroll'], `${label}: horizontal overflow belongs to its container`).toContain(result.overflowX);
  expect(result.scrollableWidth, `${label}: additional columns are horizontally reachable`).toBeGreaterThan(1);
  expect(result.primaryText, `${label}: primary record column remains readable`).not.toBe('');
  expect(result.primaryVisibleAtStart, `${label}: primary record column is visible initially`).toBe(true);
  expect(result.selectionDoesNotOverlapPrimary, `${label}: selection control does not overlap the primary column`).toBe(true);
  expect(result.headerContentContained, `${label}: header labels stay inside their columns`).toBe(true);
  expect(result.finalVisibleAtEnd, `${label}: final column is reachable`).toBe(true);
  expect(result.actionTargets.every((target) => target.width >= 43.5 && target.height >= 43.5), `${label}: action targets remain at least 44px`).toBe(true);
}

async function assertMobileCompactAction(button, label) {
  await expect(button).toBeVisible({ timeout: 30_000 });
  const result = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      fontSize: getComputedStyle(element).fontSize,
      mobileLabel: getComputedStyle(element, '::after').content,
    };
  });
  expect(result.width, `${label}: compact action width`).toBeGreaterThanOrEqual(43.5);
  expect(result.height, `${label}: compact action height`).toBeGreaterThanOrEqual(43.5);
  expect(['0px', '14px'], `${label}: mobile label uses the shared scale`).toContain(result.fontSize);
  if (result.fontSize === '0px') {
    expect(result.mobileLabel, `${label}: short mobile label is visible`).not.toBe('none');
    expect(result.mobileLabel, `${label}: short mobile label is present`).not.toBe('""');
  }
}

async function assertFloatingSurface(page, locator, label) {
  await expect(locator).toBeVisible();
  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.left, `${label}: left edge`).toBeGreaterThanOrEqual(-1);
  expect(bounds.top, `${label}: top edge`).toBeGreaterThanOrEqual(-1);
  expect(bounds.right, `${label}: right edge`).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.bottom, `${label}: bottom edge`).toBeLessThanOrEqual(bounds.viewportHeight + 1);
}

async function assertDialogUsable(page, label) {
  const dialog = page.locator('[role="dialog"]:not(#mobile-navigation-drawer):visible').last();
  await expect(dialog).toBeVisible();
  const result = await dialog.evaluate((element) => {
    const panel = getComputedStyle(element).position === 'fixed'
      ? [...element.children].find((child) => child instanceof HTMLElement) || element
      : element;
    const rect = panel.getBoundingClientRect();
    const visible = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const style = getComputedStyle(target);
      const targetRect = target.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && targetRect.width > 0 && targetRect.height > 0
        && targetRect.bottom > 0 && targetRect.top < window.innerHeight;
    };
    const touchSelector = '.app-button, .app-icon-button, button[aria-label="Close"], input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), select, button[aria-controls="deal-products-services-content"], button[aria-controls="sale-products-services-content"], button[aria-controls="sale-payment-content"]';
    const undersized = [...panel.querySelectorAll(touchSelector)].flatMap((target) => {
      if (!visible(target)) return [];
      const targetRect = target.getBoundingClientRect();
      if (targetRect.width >= 43.5 && targetRect.height >= 43.5) return [];
      return [{ label: target.getAttribute('aria-label') || target.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80), width: targetRect.width, height: targetRect.height }];
    });
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      overflowX: panel.scrollWidth - panel.clientWidth,
      closeCount: panel.querySelectorAll('button[aria-label="Close"]').length,
      undersized,
    };
  });
  expect(result.left, `${label}: dialog left edge`).toBeGreaterThanOrEqual(-1);
  expect(result.top, `${label}: dialog top edge`).toBeGreaterThanOrEqual(-1);
  expect(result.right, `${label}: dialog right edge`).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.bottom, `${label}: dialog bottom edge`).toBeLessThanOrEqual(result.viewportHeight + 1);
  expect(result.overflowX, `${label}: dialog horizontal overflow`).toBeLessThanOrEqual(1);
  expect(result.closeCount, `${label}: dialog close action`).toBeGreaterThan(0);
  expect(result.undersized, `${label}: dialog targets smaller than 44px`).toEqual([]);
  await assertPageGeometry(page, label, { mobile: true });
  return dialog;
}

async function openQuickAction(page, label) {
  const direct = page.getByRole('button', { name: label, exact: true }).filter({ visible: true });
  if (await direct.count()) { await direct.first().click(); return; }
  await page.getByRole('button', { name: 'Quick actions' }).click();
  const menu = page.getByRole('menu', { name: 'Quick actions menu' });
  await assertFloatingSurface(page, menu, 'Quick actions menu');
  expect(await menu.getByRole('menuitem').count()).toBeGreaterThan(0);
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}

async function closeDialog(page) {
  await page.locator('[role="dialog"]:not(#mobile-navigation-drawer):visible').last().getByRole('button', { name: 'Close' }).click();
}

for (const viewport of phoneViewports) {
  test(`core screens remain usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    for (const route of routes) {
      await openRoute(page, route);
      await assertPageGeometry(page, `${route.name} at ${viewport.width}px`, { mobile: true });
    }
  });
}

test('mobile comparison view retains semantic columns with contained horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  await page.goto('/leads', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Leads & Prospects', exact: true })).toBeVisible();
  await assertMobileScrollableTable(page.locator('.leads-data-table'), 'Leads');
  await assertMobileCompactAction(page.getByRole('button', { name: 'Filter leads', exact: true }), 'Lead filter');

  await page.goto('/catalog', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Catalog', exact: true })).toBeVisible();
  await assertMobileScrollableTable(page.locator('section[aria-labelledby="products-services-heading"] table'), 'Catalog products and services');
  await assertMobileCompactAction(page.getByRole('button', { name: 'Refresh catalog items', exact: true }), 'Catalog refresh');

  await page.goto('/clients', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await assertMobileScrollableTable(page.locator('.clients-data-table'), 'Clients');
  await assertMobileCompactAction(page.getByRole('button', { name: 'Filter clients', exact: true }), 'Client filter');

  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks & Follow-ups', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
  await assertMobileScrollableTable(page.locator('table[class~="min-w-[950px]"]'), 'Tasks');
  await assertMobileCompactAction(page.getByRole('button', { name: 'Refresh tasks', exact: true }), 'Task refresh');

  await page.goto('/sales', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Sales Log', exact: true })).toBeVisible();
  await page.getByLabel('Date range').selectOption('TWENTY_EIGHT_DAYS');
  await assertMobileScrollableTable(page.locator('.sales-data-table'), 'Sales');
  await assertMobileCompactAction(page.getByRole('button', { name: 'Show archived sales', exact: true }), 'Sales archive');

  await page.goto(`/clients?clientId=${encodeURIComponent(longClient.id)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(longClient.name, { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Deals', exact: true }).click();
  await assertMobileScrollableTable(page.locator('table[class~="min-w-[900px]"]'), 'Client deals');
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await assertMobileScrollableTable(page.locator('table[class~="min-w-[820px]"]'), 'Client sales');

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Users & Access', exact: true }).click();
  await assertMobileScrollableTable(page.locator('table[class~="min-w-[760px]"]'), 'Team members');
  await assertMobileCompactAction(page.getByRole('button', { name: 'Refresh team members', exact: true }), 'Team refresh');
});

test('mobile navigation and action menus remain reachable at short phone height', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page, selectorAdmin);
  const trigger = page.getByRole('button', { name: 'More navigation' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect.poll(async () => drawer.evaluate((element) => Math.round(element.getBoundingClientRect().left)), { timeout: 1_000 }).toBe(0);
  await assertFloatingSurface(page, drawer, 'Navigation drawer');
  const drawerMetrics = await drawer.evaluate((element) => ({
    close: element.querySelector('button[aria-label="Close navigation"]')?.getBoundingClientRect().toJSON(),
    switcher: element.querySelector('select[aria-label="Switch workspace"]')?.getBoundingClientRect().toJSON(),
    signOut: element.querySelector('button[aria-label="Sign out"]')?.getBoundingClientRect().toJSON(),
    linkHeights: [...element.querySelectorAll('nav a')].map((link) => link.getBoundingClientRect().height),
    navScrollable: (() => { const nav = element.querySelector('nav'); return Boolean(nav && nav.scrollHeight > nav.clientHeight); })(),
  }));
  expect(drawerMetrics.close?.width).toBeGreaterThanOrEqual(43.5);
  expect(drawerMetrics.close?.height).toBeGreaterThanOrEqual(43.5);
  expect(drawerMetrics.switcher?.height).toBeGreaterThanOrEqual(43.5);
  expect(drawerMetrics.signOut?.width).toBeGreaterThanOrEqual(43.5);
  expect(drawerMetrics.signOut?.height).toBeGreaterThanOrEqual(43.5);
  expect(drawerMetrics.linkHeights.every((height) => height >= 43.5)).toBe(true);
  expect(drawerMetrics.navScrollable).toBe(true);
  await drawer.getByRole('button', { name: 'Close navigation' }).click();
  await expect(trigger).toBeFocused();

  await page.getByRole('button', { name: 'Quick actions' }).click();
  const menu = page.getByRole('menu', { name: 'Quick actions menu' });
  await assertFloatingSurface(page, menu, 'Dashboard quick actions');
  const menuItemHeights = await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  expect(menuItemHeights.every((height) => height >= 43.5)).toBe(true);
});

test('Dashboard uses its mobile stage list and keeps the security statement in the navigation', async ({ page }) => {
  await signIn(page);

  for (const viewport of [{ width: 320, height: 568 }, ...phoneViewports.slice(1)]) {
    await page.setViewportSize(viewport);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 30_000 });

    const mobileStages = page.locator('.pipeline-mobile-stage-list');
    await expect(mobileStages).toBeVisible();
    await expect(page.locator('.pipeline-desktop-funnel')).toBeHidden();
    await expect(mobileStages.locator('.pipeline-mobile-stage')).toHaveCount(6);
    await expect(mobileStages.getByText('Won Deal Value', { exact: true })).toBeVisible();
    await expect(mobileStages.getByText('Lost Deal Value', { exact: true })).toBeVisible();

    const dashboardLayout = await page.evaluate(() => {
      const footer = document.querySelector('#mobile-navigation-drawer .security-trust-footer');
      const dashboard = document.querySelector('.dashboard-page');
      const title = document.querySelector('.dashboard-key-metrics-title');
      const customize = document.querySelector('.dashboard-key-metrics-controls > .dashboard-customize-action');
      const range = document.querySelector('.dashboard-range-selector');
      const stageRows = [...document.querySelectorAll('.pipeline-mobile-stage')];
      if (!footer || !dashboard || !title || !customize || !range) throw new Error('Dashboard mobile layout is incomplete.');
      const titleRect = title.getBoundingClientRect();
      const customizeRect = customize.getBoundingClientRect();
      const rangeRect = range.getBoundingClientRect();
      return {
        securityInNavigation: Boolean(footer.closest('#mobile-navigation-drawer')),
        securityAbsentFromContent: !document.querySelector('.app-main-content .security-trust-footer'),
        keyMetricTitleOverlapsCustomize: titleRect.right > customizeRect.left && titleRect.left < customizeRect.right && titleRect.bottom > customizeRect.top && titleRect.top < customizeRect.bottom,
        rangeControlsDoNotOverlap: !(rangeRect.left < customizeRect.right && rangeRect.right > customizeRect.left && rangeRect.top < customizeRect.bottom && rangeRect.bottom > customizeRect.top),
        stageOverflow: stageRows.map((stage) => stage.scrollWidth - stage.clientWidth),
      };
    });

    expect(dashboardLayout.securityInNavigation).toBe(true);
    expect(dashboardLayout.securityAbsentFromContent).toBe(true);
    expect(dashboardLayout.keyMetricTitleOverlapsCustomize, `Key Metrics controls overlap at ${viewport.width}px`).toBe(false);
    expect(dashboardLayout.rangeControlsDoNotOverlap, `date range overlaps Customize at ${viewport.width}px`).toBe(true);
    expect(dashboardLayout.stageOverflow, `pipeline rows overflow at ${viewport.width}px`).toEqual([0, 0, 0, 0, 0, 0]);
    await assertPageGeometry(page, `Dashboard mobile layout at ${viewport.width}px`, { mobile: true });
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.pipeline-mobile-stage-list')).toBeHidden();
  await expect(page.locator('.pipeline-desktop-funnel')).toBeVisible();
  await assertPageGeometry(page, 'Dashboard desktop pipeline');
});

test('Dashboard record shortcuts use semantic deep links without crossing the active workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);

  const leadLink = page.getByRole('link', { name: 'Open lead: UAT Prospect', exact: true });
  await expect(page.locator('.dashboard-record-row[role="button"]')).toHaveCount(0);
  await expect(leadLink).toHaveAttribute('href', /\/leads\?leadId=uat-lead-001$/);
  await leadLink.press('Enter');
  await expect(page).toHaveURL(/\/leads\?leadId=uat-lead-001$/);
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'UAT Prospect', exact: true })).toBeVisible();
  await page.goBack();

  const clientLink = page.getByRole('link', { name: 'Open client: Northwestern Pacific Integrated Business Solutions and Advisory Services', exact: true });
  await expect(clientLink).toHaveAttribute('href', /\/clients\?clientId=uat-client-mobile-long$/);
  await clientLink.click();
  await expect(page).toHaveURL(/\/clients\?clientId=uat-client-mobile-long$/);
  await page.goBack();

  const dealLink = page.getByRole('link', { name: 'Open deal: Enterprise Operations Modernization and Regional Expansion Partnership', exact: true });
  await expect(dealLink).toHaveAttribute('href', /\/pipeline\?dealId=uat-deal-mobile-long$/);
  await dealLink.click();
  await expect(page).toHaveURL(/\/pipeline\?dealId=uat-deal-mobile-long$/);
  await page.goBack();

  const taskLink = page.getByRole('link', { name: 'Open task: Follow up with UAT Prospect', exact: true });
  await expect(taskLink).toHaveAttribute('href', /\/tasks\?taskId=uat-task-001$/);
  await taskLink.click();
  await expect(page).toHaveURL(/\/tasks\?taskId=uat-task-001$/);
  await page.goBack();

  const activityLink = page.getByRole('link', { name: 'Open related record for activity: UAT sample client created', exact: true });
  await activityLink.click();
  await expect(page).toHaveURL(/\/clients\?clientId=uat-client-001$/);
  await page.goBack();

  const informationalActivity = page.getByText('UAT informational activity', { exact: true });
  await expect(informationalActivity.locator('xpath=..').locator('xpath=..')).not.toHaveAttribute('href');

  const completion = page.getByRole('button', { name: 'Complete task: Follow up with UAT Prospect', exact: true });
  await completion.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(taskLink).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await assertPageGeometry(page, 'Dashboard record shortcuts on mobile', { mobile: true });
});

test('Dashboard shortcuts discard prior-workspace records after a workspace switch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, selectorAdmin);

  const workspaceAClient = page.getByRole('link', { name: 'Open client: Northwestern Pacific Integrated Business Solutions and Advisory Services', exact: true });
  await expect(workspaceAClient).toBeVisible();

  await page.getByLabel('Switch workspace').selectOption('bsm-uat-org-b');
  const workspaceBClient = page.getByRole('link', { name: 'Open client: Workspace B Private Client', exact: true });
  await expect(workspaceBClient).toBeVisible({ timeout: 30_000 });
  await expect(workspaceAClient).toHaveCount(0);

  await workspaceBClient.click();
  await expect(page).toHaveURL(/\/clients\?clientId=uat-client-org-b-only$/);
});

test('representative forms, selectors, and dialogs fit a 320px phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page);

  await openQuickAction(page, 'Add Lead');
  await assertDialogUsable(page, 'Dashboard Add Lead');
  await closeDialog(page);

  await openRoute(page, routes.find((route) => route.name === 'Clients'));
  await openQuickAction(page, 'Add Client');
  await assertDialogUsable(page, 'Add Client');
  await closeDialog(page);

  await openRoute(page, routes.find((route) => route.name === 'Pipeline'));
  await openQuickAction(page, 'Add Deal');
  const dealDialog = await assertDialogUsable(page, 'Add Deal');
  const clientSelector = dealDialog.getByRole('combobox', { name: 'Client' });
  await clientSelector.fill('UAT Client');
  await assertFloatingSurface(page, dealDialog.getByRole('listbox'), 'Deal Client selector');
  await closeDialog(page);

  await openRoute(page, routes.find((route) => route.name === 'Tasks'));
  await openQuickAction(page, 'Add Task');
  await assertDialogUsable(page, 'Add Task');
  await closeDialog(page);

  await openRoute(page, routes.find((route) => route.name === 'Catalog'));
  await openQuickAction(page, 'Add Item');
  await assertDialogUsable(page, 'Add Catalog item');
  await closeDialog(page);

  await openRoute(page, routes.find((route) => route.name === 'Sales'));
  await page.getByRole('button', { name: 'Record Sale', exact: true }).first().click();
  await assertDialogUsable(page, 'Record Sale');
  await closeDialog(page);

  await openRoute(page, routes.find((route) => route.name === 'Reports'));
  await page.getByRole('button', { name: 'Customize Cards' }).click();
  await assertDialogUsable(page, 'Customize Reports cards');
  await closeDialog(page);
});

test('long Client and Deal details plus Sale payment dialogs remain contained', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page);

  await page.goto(`/clients?clientId=${encodeURIComponent(longClient.id)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(longClient.name, { exact: true })).toBeVisible({ timeout: 30_000 });
  await assertPageGeometry(page, 'Long Client details', { mobile: true });

  await openRoute(page, routes.find((route) => route.name === 'Pipeline'));
  await page.getByRole('tab', { name: /^Won/ }).click();
  await page.getByRole('button', { name: `Open deal ${longDeal.title}`, exact: true }).click();
  await assertDialogUsable(page, 'Long Deal details');
  await closeDialog(page);

  await openRoute(page, routes.find((route) => route.name === 'Sales'));
  await page.getByLabel('Date range').selectOption('TWENTY_EIGHT_DAYS');
  const viewSale = page.getByRole('button', { name: `View ${partialSale.saleNumber}`, exact: true });
  await expect(viewSale).toBeVisible({ timeout: 30_000 });
  await viewSale.click();
  const saleDialog = await assertDialogUsable(page, 'Sale details');
  await saleDialog.getByRole('button', { name: 'Record Payment' }).click();
  await assertDialogUsable(page, 'Record Payment');
});

test('tablet and desktop layouts remain contained', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await signIn(page);
  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await openRoute(page, route);
      await assertPageGeometry(page, `${route.name} at ${width}px`);
    }
  }
});

test('mobile tables preserve selection, sorting, record actions, and bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const tabs = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
  await tabs.getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Clients', exact: true })).toHaveAttribute('aria-current', 'page');
  const records = page.locator('.clients-data-table');
  await expect(records).toBeVisible();
  await expect(page.locator('.mobile-record-list')).toHaveCount(0);
  const firstCheckbox = records.locator('tbody').getByRole('checkbox').first();
  const selectionName = await firstCheckbox.getAttribute('aria-label');
  await firstCheckbox.check();
  const sort = records.getByRole('button', { name: 'Sort loaded results by Client', exact: true });
  await sort.click();
  await expect(sort.locator('..')).toHaveAttribute('aria-sort', /ascending|descending/);
  await expect(page.getByRole('checkbox', { name: selectionName, exact: true })).toBeChecked();
  await records.locator('tbody tr td').filter({has: page.getByRole('button', {name: longClient.name, exact:true})}).getByRole('button').click();
  await expect(page.locator('.client-profile-tabs')).toBeVisible();
  await tabs.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const more = tabs.getByRole('button', { name: 'More navigation' });
  await more.click();
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Close navigation', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
});

test('UI refresh desktop and phone visual captures', async ({ page }) => {
  await signIn(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [routes[0], routes[2], routes[3], routes[4]]) {
      await openRoute(page, route);
      if (route.name === 'Clients') await expect(page.getByRole('button', { name: longClient.name, exact: true })).toBeVisible();
      if (route.name === 'Pipeline' && width < 768) await page.getByRole('tab', { name: /^Won/ }).click();
      if (route.name === 'Tasks') await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
      await page.screenshot({ path: `/private/tmp/ventale-ui-${width}-${route.name.toLowerCase()}.png` });
    }
    if (width === 390) {
      await openRoute(page, routes[3]);
      await openQuickAction(page, 'Add Deal');
      await page.screenshot({ path: '/private/tmp/ventale-ui-390-add-deal.png' });
      await closeDialog(page);
    }
  }
});

async function assertCompactLayout(page, label, { mobile = true } = {}) {
  await assertPageGeometry(page, label, { mobile });
  const geometry = await page.evaluate(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight && !e.closest('[inert]'); };
    const controls = [...document.querySelectorAll('.app-main-content button, .app-main-content input:not([type="checkbox"]), .app-main-content select')].filter(visible);
    const rects = controls.map(e => ({e, r: (e.matches('[aria-label^="Open deal "]') ? e.querySelector('.line-clamp-2') || e : e).getBoundingClientRect(), name: e.getAttribute('aria-label') || e.textContent.trim().slice(0,60)}));
    const collisions = [];
    for (let i=0;i<rects.length;i++) for(let j=i+1;j<rects.length;j++) {
      const a=rects[i], b=rects[j];
      if(a.e.contains(b.e)||b.e.contains(a.e)||a.e.closest('table')||b.e.closest('table')) continue;
      const w=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left), h=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
      if(w>3 && h>3) collisions.push([a.name,b.name]);
    }
    const oversized = rects.filter(x => x.r.height > 56 && !x.e.matches('[role="tab"]') && !x.e.closest('.settings-navigation, table') && !x.e.matches('[aria-label^="Open deal "]')).map(x=>({name:x.name,height:x.r.height}));
    return {collisions,oversized,rootSize:getComputedStyle(document.documentElement).fontSize,mainSize:getComputedStyle(document.querySelector('.app-main-content')).fontSize,headerHeight:document.querySelector('.page-header')?.getBoundingClientRect().height,kpiHeight:document.querySelector('.bsm-kpi-card, .dashboard-kpi-card')?.getBoundingClientRect().height,firstRecordHeight:document.querySelector('tbody tr')?.getBoundingClientRect().height,filterHeight:document.querySelector('.bsm-filter-bar')?.getBoundingClientRect().height,navHeight:document.querySelector('.mobile-tab-bar')?.getBoundingClientRect().height};
  });
  expect(geometry.collisions, `${label}: controls must not overlap`).toEqual([]);
  expect(geometry.rootSize).toBe('16px');
  if (mobile) {
    expect(geometry.oversized, `${label}: unexplained oversized controls`).toEqual([]);
    expect(geometry.mainSize).toBe('14px');
    expect(geometry.navHeight).toBeLessThanOrEqual(62);
  }
  return geometry;
}

async function assertTabsScroll(page, selector, label) {
  const tabs = page.locator(selector);
  const result = await tabs.evaluate(async e => {
    const children = [...e.querySelectorAll('button')];
    const last = children.at(-1);
    e.scrollLeft = e.scrollWidth;
    await new Promise(requestAnimationFrame);
    const parent = e.getBoundingClientRect(), r = last?.getBoundingClientRect();
    return {scrollable:e.scrollWidth>e.clientWidth+1,overflow:getComputedStyle(e).overflowX,shrunk:children.some(b=>b.scrollWidth>b.clientWidth+1),lastReachable:!r || r.right<=parent.right+1,labelSize:last?getComputedStyle(last).fontSize:null};
  });
  expect(['auto','scroll']).toContain(result.overflow);
  expect(result.shrunk, `${label}: tab labels must not clip`).toBe(false);
  expect(result.lastReachable, `${label}: final tab must be horizontally reachable`).toBe(true);
  expect(result.labelSize).toBe('14px');
  await tabs.evaluate(e => {e.scrollLeft=0;});
}

async function assertMobileControlScale(scope, label) {
  const controls = await scope.locator('.app-button, .app-icon-button, .modal-close-button, .mobile-icon-control, .mobile-sort-action').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height || style.visibility === 'hidden') return [];
    const face = getComputedStyle(element, '::before');
    const shortLabel = style.fontSize === '0px';
    const iconOnly = element.matches('.app-icon-button, .modal-close-button, .mobile-icon-control, .mobile-icon-only');
    return [{
      name: element.getAttribute('aria-label') || element.textContent.trim(),
      width: bounds.width, height: bounds.height,
      fontSize: shortLabel ? getComputedStyle(element, '::after').fontSize : style.fontSize,
      weight: shortLabel ? getComputedStyle(element, '::after').fontWeight : style.fontWeight,
      radius: style.borderRadius, gap: style.gap,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      faceHeight: face.content !== 'none' ? parseFloat(face.height) : null,
      action: element.classList.contains('app-button'), iconOnly,
      labelled: !iconOnly || Boolean(element.getAttribute('aria-label')),
      overflow: element.scrollWidth - element.clientWidth,
      icons: [...element.querySelectorAll('svg')].map((icon) => ({ width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height })),
    }];
  }));
  expect.soft(controls.length, `${label}: representative controls exist`).toBeGreaterThan(0);
  for (const control of controls) {
    const message = `${label}: ${control.name}`;
    expect.soft(control.width, `${message} target width`).toBeGreaterThanOrEqual(43.5);
    expect.soft(control.height, `${message} target height`).toBeGreaterThanOrEqual(43.5);
    expect.soft(control.labelled, `${message} accessible icon label`).toBe(true);
    expect.soft(control.radius, `${message} radius`).toBe('8px');
    expect.soft(control.overflow, `${message} unclipped content`).toBeLessThanOrEqual(1);
    for (const icon of control.icons) {
      expect.soft(icon.width, `${message} icon width`).toBe(16);
      expect.soft(icon.height, `${message} icon height`).toBe(16);
    }
    if (!control.iconOnly) {
      expect.soft(control.fontSize, `${message} text`).toBe('14px');
      expect.soft(control.weight, `${message} weight`).toBe('600');
      expect.soft(control.gap, `${message} icon gap`).toBe('6px');
    }
    if (control.action && !control.iconOnly) {
      expect.soft(control.padding, `${message} padding`).toEqual(['6px', '12px', '6px', '12px']);
      expect.soft(control.faceHeight, `${message} compact visible face`).toBe(36);
    }
  }
}

async function assertNavigationScale(strip, label) {
  // Existing color transitions need to settle after the selection changes.
  await expect.poll(() => strip.locator('button').evaluateAll((tabs) => tabs.every((tab) => {
    const selected = tab.matches('[aria-selected="true"], [aria-current="page"], [aria-pressed="true"]');
    return getComputedStyle(tab).backgroundColor === (selected ? 'rgb(231, 241, 233)' : 'rgba(0, 0, 0, 0)');
  })), { message: `${label}: selected and inactive backgrounds` }).toBe(true);
  const metrics = await strip.evaluate((element) => ({
    overflow: getComputedStyle(element).overflowX,
    scrollbar: getComputedStyle(element).scrollbarWidth,
    gap: getComputedStyle(element.querySelector(':scope > div') || element).gap,
    tabs: [...element.querySelectorAll('button')].map((tab) => {
      const style = getComputedStyle(tab), rect = tab.getBoundingClientRect();
      return {
        label: tab.textContent.trim(), height: rect.height,
        font: style.fontSize, weight: style.fontWeight, radius: style.borderRadius,
        padding: [style.paddingTop, style.paddingRight], gap: style.gap,
        clipped: tab.scrollWidth > tab.clientWidth + 1,
        background: style.backgroundColor, color: style.color,
        selected: tab.matches('[aria-selected="true"], [aria-current="page"], [aria-pressed="true"]'),
        icons: [...tab.querySelectorAll('svg')].map((icon) => icon.getBoundingClientRect().width),
      };
    }),
  }));
  expect.soft(metrics.overflow, `${label}: native horizontal scroller`).toBe('auto');
  expect.soft(metrics.scrollbar, `${label}: hidden scrollbar`).toBe('none');
  expect.soft(metrics.gap, `${label}: tab gap`).toBe('4px');
  expect.soft(metrics.tabs.filter((tab) => tab.selected), `${label}: one exposed selection`).toHaveLength(1);
  for (const tab of metrics.tabs) {
    const message = `${label}: ${tab.label}`;
    expect.soft(tab.height, `${message} full highlight height`).toBeGreaterThanOrEqual(44);
    expect.soft(tab.font).toBe('14px');
    expect.soft(tab.weight).toBe('600');
    expect.soft(tab.radius).toBe('8px');
    expect.soft(tab.padding).toEqual(['6px', '12px']);
    expect.soft(tab.gap).toBe('6px');
    expect.soft(tab.clipped, `${message}: complete label`).toBe(false);
    expect.soft(tab.icons.every((size) => size === 16)).toBe(true);
    expect.soft(tab.background).toBe(tab.selected ? 'rgb(231, 241, 233)' : 'rgba(0, 0, 0, 0)');
    if (tab.selected) expect.soft(tab.color).toBe('rgb(3, 45, 32)');
  }
}

async function assertSelectedTabVisible(strip) {
  await expect.poll(() => strip.evaluate((element) => {
    const selected = element.querySelector('[aria-selected="true"], [aria-current="page"], [aria-pressed="true"]');
    const bounds = element.getBoundingClientRect(), tab = selected?.getBoundingClientRect();
    return Boolean(tab && tab.left >= bounds.left - 1 && tab.right <= bounds.right + 1);
  })).toBe(true);
}

async function assertHeaderActionsDoNotOverlap(page) {
  const collisions = await page.locator('.page-header').evaluate((header) => {
    const buttons = [...header.querySelectorAll('.app-button')].filter((button) => button.getBoundingClientRect().width > 0);
    const result = [];
    for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i].getBoundingClientRect(), b = buttons[j].getBoundingClientRect();
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) result.push([buttons[i].textContent, buttons[j].textContent]);
    }
    return result;
  });
  expect(collisions, 'Page header action targets do not overlap').toEqual([]);
}

for (const viewport of phoneViewports) {
  test(`Mobile control system at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await signIn(page);
    for (const route of routes.filter((item) => item.name !== 'Feedback')) {
      await openRoute(page, route);
      await assertPageGeometry(page, `${route.name} ${viewport.width}px`, { mobile: true });
      await assertMobileControlScale(page.locator('.app-main-content'), route.name);
      await assertHeaderActionsDoNotOverlap(page);
      if (viewport.width === 390) await page.screenshot({ path: `/private/tmp/ventale-controls-390-${route.name.toLowerCase()}.png` });
      if (['Tasks', 'Catalog', 'Pipeline', 'Settings'].includes(route.name)) {
        const strip = page.locator('.mobile-navigation-tabs').first();
        await assertNavigationScale(strip, route.name);
        await strip.locator('button').last().click();
        await assertNavigationScale(strip, `${route.name} changed selection`);
        await assertSelectedTabVisible(strip);
      }
      if (route.name === 'Dashboard') {
        const customize = page.getByRole('button', { name: 'Customize dashboard', exact: true });
        await expect(customize.locator('.mobile-button-label')).toBeHidden();
        const size = await customize.boundingBox();
        expect(size.width).toBe(44);
        expect(size.height).toBe(44);
        await customize.click();
        const dialog = await assertDialogUsable(page, 'Customize Dashboard');
        await assertMobileControlScale(dialog, 'Customize Dashboard');
        await closeDialog(page);
      }
    }
    await page.goto(`/clients?clientId=${encodeURIComponent(longClient.id)}`, { waitUntil: 'domcontentloaded' });
    const strip = page.locator('.client-profile-tabs');
    await expect(strip).toBeVisible();
    await assertNavigationScale(strip, 'Client Details');
    await assertMobileControlScale(page.locator('.app-main-content'), 'Client Details');
    for (const label of ['Activity Log', 'Notes', 'Documents']) {
      await strip.getByRole('button', { name: label, exact: true }).click();
      await assertSelectedTabVisible(strip);
      await expect(strip.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
    await strip.getByRole('button', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('End');
    await expect(strip.getByRole('button', { name: 'Documents', exact: true })).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(strip.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await assertSelectedTabVisible(strip);
    const focus = await strip.getByRole('button', { name: 'Overview', exact: true }).evaluate((tab) => getComputedStyle(tab).outlineWidth);
    expect(focus).toBe('2px');
    if (viewport.width === 390) await page.screenshot({ path: '/private/tmp/ventale-controls-390-client-detail.png' });
    await page.goto('/tasks');
    const followUps = page.getByRole('button', { name: 'Follow-ups', exact: true });
    await followUps.click();
    await expect(followUps).toHaveAttribute('aria-pressed', 'true');
    await assertSelectedTabVisible(page.locator('.task-tabs'));
    const bottom = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
    await expect(bottom.getByRole('link')).toHaveCount(4);
    await expect(bottom.getByRole('button', { name: 'More navigation' })).toHaveCount(1);
    expect(await bottom.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
    if ([320, 390, 430].includes(viewport.width)) await page.screenshot({ path: `/private/tmp/ventale-controls-${viewport.width}-tasks.png` });
  });
}

test('Mobile tab strips respond to native touch swipe and keyboard selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openRoute(page, routes.find((route) => route.name === 'Pipeline'));
  const strip = page.locator('.pipeline-stage-tabs');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await strip.evaluate((element) => { element.scrollLeft = 0; });
  const box = await strip.boundingBox();
  const y = box.y + box.height / 2, start = box.x + box.width - 20;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
  for (let step = 1; step <= 10; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start - step * 20, y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await strip.getByRole('tab').first().focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(strip.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
  await assertSelectedTabVisible(strip);
  await assertNavigationScale(strip, 'Pipeline after touch and keyboard');
  await session.detach();
});

test('Mobile warning and destructive confirmations use the shared control scale', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await signIn(page);
  await page.goto(`/clients?clientId=${encodeURIComponent(longClient.id)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.client-profile-hero')).toBeVisible();
  await page.getByRole('button', { name: 'Archive Client', exact: true }).click();
  let dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await assertMobileControlScale(dialog, 'Warning confirmation');
  await expect(dialog.getByRole('button', { name: 'Archive', exact: true })).toHaveAttribute('data-button-variant', 'warning');
  const rows = await dialog.locator('.mobile-dialog-actions .app-button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(rows[0], 'Short confirmation labels remain side-by-side').toBe(rows[1]);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await openRoute(page, routes.find((route) => route.name === 'Clients'));
  await page.locator('.clients-data-table tbody').getByRole('checkbox').first().check();
  const bulk = page.getByRole('region', { name: 'Bulk actions', exact: true });
  await bulk.getByLabel('Bulk action', { exact: true }).selectOption('trash');
  await bulk.getByRole('button', { name: 'Apply', exact: true }).click();
  dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible();
  await assertMobileControlScale(dialog, 'Destructive confirmation');
  await expect(dialog.getByRole('button', { name: 'Move to Trash', exact: true })).toHaveAttribute('data-button-variant', 'danger');
  await assertPageGeometry(page, 'Destructive confirmation at 320px', { mobile: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  // Neither lifecycle confirmation is submitted; no CRM records are changed.
});

test('Mobile control standard preserves tablet and desktop presentation', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes.filter((item) => item.name !== 'Feedback')) {
      await openRoute(page, route);
      await assertPageGeometry(page, `${route.name} desktop ${width}px`);
      const faces = await page.locator('.app-main-content .app-button').evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button, '::before').content));
      expect(faces.every((face) => face === 'none'), 'Compact mobile faces are absent on desktop').toBe(true);
      if (route.name === 'Dashboard') await expect(page.locator('.dashboard-customize-action .mobile-button-label')).toBeVisible();
      if (route.name === 'Settings') {
        const navigation = page.locator('.settings-navigation');
        expect(await navigation.evaluate((element) => getComputedStyle(element).display)).not.toBe('flex');
        expect(await navigation.locator('button').first().evaluate((button) => button.getBoundingClientRect().height)).toBe(48);
      }
    }
  }
});

for (const viewport of phoneViewports) {
  test(`Compact mobile rhythm at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    const measurement = {};
    for(const route of routes) {
      await openRoute(page,route);
      measurement[route.name] = await assertCompactLayout(page, `${route.name} compact ${viewport.width}`);
      if(route.name==='Tasks') await assertTabsScroll(page,'.task-tabs','Task tabs');
      if(viewport.width===390 && ['Dashboard','Leads','Clients','Tasks'].includes(route.name)) await page.screenshot({path:`/private/tmp/ventale-compact-after-390-${route.name.toLowerCase()}.png`});
    }
    await page.goto(`/clients?clientId=${encodeURIComponent(longClient.id)}`, {waitUntil:'domcontentloaded'});
    await expect(page.locator('.client-profile-hero')).toBeVisible();
    await assertCompactLayout(page,`Client details ${viewport.width}`);
    await assertTabsScroll(page,'.client-profile-tabs','Client tabs');
    const hero = await page.locator('.client-profile-hero').evaluate(e=>e.getBoundingClientRect().height);
    if(viewport.width>=375) expect(hero,'Client hero should stay below the prior 379px long-name fixture').toBeLessThan(340);
    await expect(page.getByRole('button',{name:'Edit Client',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Archive Client',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Add Deal',exact:true})).toBeVisible();
    if(viewport.width===390) await page.screenshot({path:'/private/tmp/ventale-compact-after-390-client-detail.png'});
    await page.goto('/', {waitUntil:'domcontentloaded'});
    await expect(page.locator('.app-main-content .security-trust-footer')).toHaveCount(0);
    await expect(page.locator('#mobile-navigation-drawer .security-trust-footer')).toHaveCount(1);
    console.log('COMPACT_AFTER',viewport.width,JSON.stringify({...measurement,clientHeroHeight:hero}));
  });
}

test('Compact refactor preserves desktop geometry at 1280px',async ({page})=>{
  await page.setViewportSize({width:1280,height:844});
  await signIn(page);
  for(const route of routes){
    await openRoute(page,route);
    const result=await assertCompactLayout(page,`${route.name} desktop`,{mobile:false});
    expect(Math.abs(result.headerHeight-61)).toBeLessThan(1);
    if(route.name==='Clients'){
      const filter=await page.locator('.page-filter-panel').evaluate(e=>e.getBoundingClientRect().height);
      expect(Math.abs(filter-80)).toBeLessThan(1);
      await page.screenshot({path:'/private/tmp/ventale-compact-after-1280-clients.png'});
    }
  }
  await page.goto(`/clients?clientId=${encodeURIComponent(longClient.id)}`,{waitUntil:'domcontentloaded'});
  await expect(page.locator('.client-profile-hero')).toBeVisible();
  const hero=await page.locator('.client-profile-hero').evaluate(e=>e.getBoundingClientRect().height);
  expect(Math.abs(hero-231)).toBeLessThan(1);
  await page.screenshot({path:'/private/tmp/ventale-compact-after-1280-client-detail.png'});
});
