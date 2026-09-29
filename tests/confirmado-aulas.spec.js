import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://gtm.rodrigorosar.com.br/**', (r) => r.abort());
});

test('página de obrigado das aulas abre', async ({ page }) => {
  await page.goto('/confirmado-aulas/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('credenciamento é o passo principal; grupo continua disponível', async ({ page }) => {
  await page.goto('/confirmado-aulas/');
  const cred = page.getByRole('link', { name: 'Fazer meu credenciamento' });
  await expect(cred).toHaveAttribute('href', '/credenciamento/?utm_source=obrigado-aulas');
  await expect(cred).toHaveClass(/bg-cta/);
  await expect(page.getByRole('link', { name: 'Entrar no grupo do Workshop' })).toHaveAttribute('href', 'https://chat.whatsapp.com/IGTAhvFF5wAHjnnAu2fw3l');
  await expect(page.getByText('Faça seu credenciamento')).toBeVisible();
});

// M-12 (regra AI-ready: imagem acima da dobra nunca "lazy"): esta página não
// tem vídeo — a única imagem da primeira tela é o logo, que já nasce sem
// lazy e com fetchpriority alto. Trava essa garantia contra regressão.
test('logo do topo sem carregamento preguiçoso', async ({ page }) => {
  await page.goto('/confirmado-aulas/');
  const logo = page.locator('header img');
  await expect(logo).toHaveAttribute('fetchpriority', 'high');
  expect(await logo.getAttribute('loading')).not.toBe('lazy');
});
