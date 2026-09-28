// tests/acessibilidade.spec.js
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { avancar, exemplo, prepararRotas, preencherEtapa1, preencherTudo, responderEtapa, URL_TESTE } from './ajudantes.js';

async function semViolacoesGraves(page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('etapa 1 (inclusive com erros na tela)', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  await semViolacoesGraves(page);
  await avancar(page);
  await semViolacoesGraves(page);
});

test('etapa 4 (endereço e consentimento)', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await responderEtapa(page, 2, exemplo.respostas);
  await avancar(page);
  await responderEtapa(page, 3, exemplo.respostas);
  await avancar(page);
  await expect(page.getByText('Etapa 4 de 4')).toBeVisible();
  await semViolacoesGraves(page);
});

test('tela de sucesso', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  await semViolacoesGraves(page);
});

// M-5: tela nova da vigia da carga (script da página não carregou).
test('falha ao carregar um script da página', async ({ page }) => {
  await prepararRotas(page);
  await page.route('**/credenciamento/envio.js', (r) => r.fulfill({ status: 404, body: 'não encontrado' }));
  await page.goto(URL_TESTE);
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await semViolacoesGraves(page);
});

test('tudo se faz pelo teclado: Enter avança a etapa', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await page.getByLabel('Nome completo').press('Enter');
  await expect(page.getByText('Etapa 2 de 4')).toBeVisible();
  await expect(page.locator('#titulo-etapa')).toBeFocused();
});
