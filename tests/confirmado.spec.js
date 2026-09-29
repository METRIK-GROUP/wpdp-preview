import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://gtm.rodrigorosar.com.br/**', (r) => r.abort());
});

test('página de obrigado abre', async ({ page }) => {
  await page.goto('/confirmado/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
