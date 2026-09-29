// tests/acessibilidade.spec.js
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { avancar, COM_CHAVE, exemplo, formulario, prepararRotas, preencherEtapa1, preencherTudo, responderEtapa, servirTurnstile, SUCESSO, URL_TESTE } from './ajudantes.js';

async function semViolacoesGraves(page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('etapa 1 (inclusive com erros na tela)', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
  await semViolacoesGraves(page);
  await avancar(page);
  await semViolacoesGraves(page);
});

test('etapa 2 (inclusive com erros na tela)', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
  await semViolacoesGraves(page);
  await avancar(page);
  await expect(page.locator('#erro-respostas-idade')).toBeVisible();
  await semViolacoesGraves(page);
});

test('etapa 3 com a autorização (inclusive com erros na tela)', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await responderEtapa(page, 2, exemplo.respostas);
  await avancar(page);
  await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
  await expect(page.getByLabel(/Autorizo o Instituto METRIK/)).toBeVisible();
  await semViolacoesGraves(page);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.locator('#erro-consentimento')).toBeVisible();
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

test('tela de sucesso sem o e-mail enviado ("Copiar meu link")', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [{ status: 201, json: { ...SUCESSO, emailEnviado: false } }] });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.getByRole('button', { name: 'Copiar meu link' })).toBeVisible();
  await semViolacoesGraves(page);
});

test('credenciamento encerrado ao abrir a página', async ({ page }) => {
  await prepararRotas(page, { formularioResposta: { ...formulario, aberto: false } });
  await page.goto(URL_TESTE);
  await expect(page.getByRole('heading', { name: 'O credenciamento da 8ª edição foi encerrado.' })).toBeVisible();
  await semViolacoesGraves(page);
});

test('credenciamento encerrado depois de um 410 no envio', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [{ status: 410, json: { ok: false, erro: 'O credenciamento desta edição foi encerrado.' } }] });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.getByRole('heading', { name: 'O credenciamento da 8ª edição foi encerrado.' })).toBeVisible();
  await semViolacoesGraves(page);
});

test('falha ao carregar o formulário (servidor fora nas duas tentativas)', async ({ page }) => {
  await prepararRotas(page, { formularioStatus: 503 });
  await page.goto(URL_TESTE);
  await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toBeVisible();
  await semViolacoesGraves(page);
});

test('falha no envio (rede): aviso com "Tentar de novo"', async ({ page }) => {
  await prepararRotas(page, { envioFalhaRede: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  await semViolacoesGraves(page);
});

test('aviso do 409 (formulário atualizado) com "Recarregar a página"', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [{ status: 409, json: { ok: false, erro: 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.' } }] });
  let buscas = 0;
  await page.route('**/api/public/credenciamento/formulario*', (r) => {
    buscas += 1;
    return buscas === 1 ? r.fulfill({ json: formulario }) : r.fulfill({ status: 503, json: {} });
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.getByRole('button', { name: 'Recarregar a página' })).toBeVisible();
  await semViolacoesGraves(page);
});

// C1: última etapa com a verificação anti-robô ligada (widget falso com iframe titulado, como o real).
test('etapa 3 com a verificação anti-robô (Turnstile) ligada', async ({ page }) => {
  await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await responderEtapa(page, 2, exemplo.respostas);
  await avancar(page);
  await expect(page.locator('#verificacao iframe')).toHaveCount(1);
  await semViolacoesGraves(page);
});

// R-b: desafio interativo com a dica visível ao lado do widget.
test('etapa 3 com o desafio interativo e a dica visível', async ({ page }) => {
  await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { interativo: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
  await expect(page.locator('#verificacao-dica')).toHaveText('Falta só uma confirmação: marque a caixa acima para enviar.');
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

// Fix "página espera o servidor acordar": confere que a mensagem calma perto
// do esqueleto ("Carregando o formulário…") não introduz violação de
// acessibilidade enquanto fica visível (relógio falso para chegar aos ~8 s
// sem esperar de verdade; a resposta do servidor simulado fica pendurada até
// o teste liberar).
test('sem violações graves de acessibilidade com a mensagem de espera da carga visível', async ({ page }) => {
  let liberar;
  const pronta = new Promise((resolver) => {
    liberar = resolver;
  });
  await prepararRotas(page);
  await page.route('**/api/public/credenciamento/formulario*', async (r) => {
    await pronta;
    return r.fulfill({ json: formulario });
  });
  await page.clock.install();
  await page.goto(URL_TESTE);
  await page.clock.fastForward(8_001);
  await expect(page.getByText('Carregando o formulário… pode levar alguns segundos.')).toBeVisible();
  await semViolacoesGraves(page);
  liberar();
  await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
});

test('tudo se faz pelo teclado: Enter avança a etapa', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await page.getByLabel('Nome completo').press('Enter');
  await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
  await expect(page.locator('#titulo-etapa')).toBeFocused();
});
