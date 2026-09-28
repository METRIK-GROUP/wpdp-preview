import { expect, test } from '@playwright/test';
import { prepararRotas, URL_TESTE } from './ajudantes.js';

test.describe('estrutura da página', () => {
  test('noindex, título, logo sem lazy e sem Tailwind CDN', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page).toHaveTitle('Credenciamento · Workshop PDP + IA');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    const logo = page.locator('header img');
    await expect(logo).toHaveAttribute('fetchpriority', 'high');
    await expect(logo).toHaveAttribute('width', '1050');
    expect(await logo.getAttribute('loading')).toBeNull();
    expect(await page.locator('script[src*="tailwindcss"]').count()).toBe(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Workshop Projeto de Primeira + IA' })).toBeVisible();
    await expect(page.getByText('Leva cerca de 5 minutos. Seu progresso fica salvo neste aparelho.')).toBeVisible();
    await expect(page.getByText('Metrik Projetos de Interiores e Produtos LTDA · CNPJ 22.555.309/0001-80')).toBeVisible();
  });
});
