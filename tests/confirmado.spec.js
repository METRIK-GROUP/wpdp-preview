import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://gtm.rodrigorosar.com.br/**', (r) => r.abort());
});

test('página de obrigado abre', async ({ page }) => {
  await page.goto('/confirmado/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('credenciamento é o passo principal; grupo continua disponível', async ({ page }) => {
  await page.goto('/confirmado/');
  const cred = page.getByRole('link', { name: 'Fazer meu credenciamento' });
  await expect(cred).toHaveAttribute('href', '/credenciamento/?utm_source=obrigado');
  await expect(cred).toHaveClass(/bg-cta/);
  await expect(page.getByRole('link', { name: 'Entrar no grupo do Workshop' })).toHaveAttribute('href', 'https://chat.whatsapp.com/IGTAhvFF5wAHjnnAu2fw3l');
  await expect(page.getByText('Assista o vídeo e faça seu credenciamento')).toBeVisible();
});

// M-12 (regra AI-ready: imagem acima da dobra nunca "lazy"): a miniatura do
// vídeo é o maior elemento da primeira tela no celular. Continua com
// decoding="async"; fetchpriority="high" fica só no logo, a primeira imagem.
test('miniatura do vídeo sem carregamento preguiçoso', async ({ page }) => {
  await page.goto('/confirmado/');
  const miniatura = page.locator('#yt-player img.yt-thumb');
  await expect(miniatura).toHaveAttribute('decoding', 'async');
  expect(await miniatura.getAttribute('loading')).toBeNull();
});
