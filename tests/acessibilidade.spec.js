// tests/acessibilidade.spec.js
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { avancar, COM_CHAVE, exemplo, prepararRotas, preencherEtapa1, preencherTudo, responderEtapa, servirTurnstile, URL_TESTE } from './ajudantes.js';

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

// C1: etapa 4 com a verificação anti-robô ligada (widget falso com iframe titulado, como o real).
test('etapa 4 com a verificação anti-robô (Turnstile) ligada', async ({ page }) => {
  await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await responderEtapa(page, 2, exemplo.respostas);
  await avancar(page);
  await responderEtapa(page, 3, exemplo.respostas);
  await avancar(page);
  await expect(page.locator('#verificacao iframe')).toHaveCount(1);
  await semViolacoesGraves(page);
});

// C3: erro 400 do servidor mostrado na etapa 1 (chave desconhecida ignorada).
test('erro do servidor (400) de volta na etapa 1', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 400, json: { ok: false, erro: 'Revise os campos destacados.', campos: { 'respostas.nao_existe': 'Campo desconhecido.', email: 'E-mail inválido' } } }],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.locator('#erro-email')).toHaveText('E-mail inválido');
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
