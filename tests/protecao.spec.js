// tests/protecao.spec.js
// C1: verificação anti-robô OPCIONAL (Cloudflare Turnstile). Só liga quando o
// GET do formulário traz protecao.turnstileSiteKey; nunca bloqueia o envio.
// O script da Cloudflare é trocado por um falso (servirTurnstile, em ajudantes.js).
import { expect, test } from '@playwright/test';
import {
  avancar,
  COM_CHAVE,
  exemplo,
  preencherEtapa1,
  preencherTudo,
  prepararRotas,
  responderEtapa,
  SCRIPT_TURNSTILE,
  servirTurnstile,
  SUCESSO,
  URL_TESTE,
  vigiarTurnstile,
} from './ajudantes.js';

const confirmar = (page) => page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
const registro = (page) => page.evaluate(() => window.__turnstile || null);
const renders = (page) => page.evaluate(() => (window.__turnstile ? window.__turnstile.renders.length : 0));
const SEM_TOKEN_503 = { status: 503, json: { ok: false, erro: 'Instabilidade momentânea.' } };

test('sem chave do site: nenhum pedido à Cloudflare e o envio vai sem token', async ({ page }) => {
  const pedidos = vigiarTurnstile(page);
  const enviados = await prepararRotas(page);
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(pedidos).toEqual([]);
  expect(enviados).toHaveLength(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
  await expect(page.locator('#verificacao')).toHaveCount(0);
});

test('com chave do site: o envio leva o token e o widget é reiniciado depois', async ({ page }) => {
  const pedidos = vigiarTurnstile(page);
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect(page.locator('#verificacao + .acoes')).toHaveCount(1); // caixa logo acima dos botões
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
  const { tempoPreenchimentoS, turnstileToken, ...resto } = enviados[0];
  const { tempoPreenchimentoS: _ignorado, ...esperado } = exemplo;
  expect(turnstileToken).toBe('tok-1');
  expect(resto).toEqual(esperado); // de resto, o contrato de sempre
  expect(pedidos).toEqual([SCRIPT_TURNSTILE]);
  const r = await registro(page);
  expect(r.renders).toEqual([
    {
      sitekey: 'chave-de-teste',
      appearance: 'interaction-only',
      size: 'flexible',
      language: 'pt-br',
      refreshExpired: 'auto',
      responseField: false,
      callbacks: ['callback', 'expired-callback', 'error-callback'],
      noDocumento: true,
    },
  ]);
  expect(r.resets).toEqual(['w1']); // token é de uso único: reiniciado depois da tentativa
});

test('o script do Turnstile só carrega na etapa 4, uma vez só', async ({ page }) => {
  const pedidos = vigiarTurnstile(page);
  await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await responderEtapa(page, 2, exemplo.respostas);
  await avancar(page);
  await responderEtapa(page, 3, exemplo.respostas);
  expect(pedidos).toEqual([]); // nada nas etapas 1 a 3
  await avancar(page);
  await expect.poll(() => renders(page)).toBe(1);
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByText('Etapa 3 de 4')).toBeVisible();
  await avancar(page);
  await expect.poll(() => renders(page)).toBe(2); // widget novo na etapa 4 redesenhada...
  expect(pedidos).toHaveLength(1); // ...sem pedir o script de novo
  expect((await registro(page)).removes).toEqual(['w1']); // e o antigo sai
});

test('script do Turnstile bloqueado: o envio segue sem token e sem aviso de erro', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await page.route('https://challenges.cloudflare.com/**', (r) => r.abort('blockedbyclient'));
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  const inicio = Date.now();
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(Date.now() - inicio).toBeLessThan(5500);
  expect(enviados).toHaveLength(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
});

test('desafio que pede interação e não termina: espera até 5 s e envia sem token', async ({ page }) => {
  await page.clock.install();
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { semToken: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  await confirmar(page);
  await expect(page.getByRole('button', { name: /Enviando/ })).toBeDisabled(); // o mesmo "ocupado" do envio
  await page.waitForTimeout(300); // prazo para um envio (errado) sair antes da espera
  expect(enviados).toHaveLength(0);
  await page.clock.fastForward(5100);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
});

test('5xx e nova tentativa: o widget é reiniciado e a nova tentativa leva outro token', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE, respostasEnvio: [SEM_TOKEN_503, { status: 201, json: SUCESSO }] });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Instabilidade momentânea.')).toBeVisible();
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados.map((e) => e.turnstileToken)).toEqual(['tok-1', 'tok-2']);
  expect((await registro(page)).resets).toEqual(['w1', 'w1']); // depois de cada tentativa
});

test('o token do Turnstile nunca vai para o rascunho nem para o dataLayer', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE, respostasEnvio: [SEM_TOKEN_503] });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  await page.getByLabel('Complemento (opcional)').fill('ap 13'); // grava o rascunho com o token já em memória
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho') || ''))
    .toContain('ap 13');
  await confirmar(page);
  await expect(page.getByText('Instabilidade momentânea.')).toBeVisible();
  expect(enviados[0].turnstileToken).toBe('tok-1'); // o token existia em memória
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('tok-');
  expect(await page.evaluate(() => JSON.stringify(window.dataLayer || []))).not.toContain('tok-');
});
