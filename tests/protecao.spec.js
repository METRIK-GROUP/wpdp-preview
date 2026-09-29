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
  await expect(page.locator('#verificacao + #verificacao-dica + .acoes')).toHaveCount(1); // widget e dica logo acima dos botões
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
  const { tempoPreenchimentoS, turnstileToken, ...resto } = enviados[0];
  const { tempoPreenchimentoS: _ignorado, ...esperado } = exemplo;
  expect(turnstileToken).toBe('tok-1');
  expect(resto).toEqual(esperado); // de resto, o contrato de sempre
  expect(pedidos).toEqual([SCRIPT_TURNSTILE]);
  const r = await registro(page);
  expect(r.renders).toHaveLength(1);
  expect(r.renders[0]).toMatchObject({
    sitekey: 'chave-de-teste',
    appearance: 'interaction-only',
    size: 'flexible', // caixa com 300 px ou mais nos 3 projetos (R-a)
    language: 'pt-br',
    refreshExpired: 'auto',
    responseField: false,
    callbacks: ['callback', 'expired-callback', 'error-callback', 'before-interactive-callback', 'after-interactive-callback', 'unsupported-callback'],
    noDocumento: true,
  });
  expect(r.renders[0].largura).toBeGreaterThanOrEqual(300);
  expect(r.resets).toEqual(['w1']); // token é de uso único: reiniciado depois da tentativa
});

// R-a: "flexible" tem largura mínima de 300 px (documentação da Cloudflare) —
// em tela estreita a caixa fica menor que isso e o widget vai "compact".
test('tela estreita (320 px): widget compacto, que cabe na caixa', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  const r = await registro(page);
  expect(r.renders[0].largura).toBeLessThan(300);
  expect(r.renders[0].size).toBe('compact');
});

test('o script do Turnstile só carrega na última etapa (a 3), uma vez só', async ({ page }) => {
  const pedidos = vigiarTurnstile(page);
  await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await responderEtapa(page, 2, exemplo.respostas);
  expect(pedidos).toEqual([]); // nada nas etapas 1 e 2
  await avancar(page);
  await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
  await expect.poll(() => renders(page)).toBe(1);
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
  await avancar(page);
  await expect.poll(() => renders(page)).toBe(2); // widget novo na etapa 3 redesenhada...
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

test('widget que não entrega token nem entra em modo interativo: espera até 5 s e envia sem token', async ({ page }) => {
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

// R-b: quem cai no desafio interativo não pode virar "suspeito" pelo corte de
// 5 s. Depois que o widget entra em modo interativo, a espera vai até o token
// (ou até 120 s desde o clique), com uma dica ao lado do widget. Relógio falso:
// nada de esperar de verdade.
const DICA = 'Falta só uma confirmação: marque a caixa acima para enviar.';
const dica = (page) => page.locator('#verificacao-dica');

async function ateOEnvioComDesafio(page, enviados) {
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  await confirmar(page);
  await expect(dica(page)).toHaveText(DICA);
  await expect(page.locator('#verificacao + #verificacao-dica')).toHaveCount(1); // logo abaixo do widget
  await expect(dica(page)).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('button', { name: /Enviando/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Voltar' })).toBeDisabled(); // ninguém sai da etapa com o envio pendente
  expect(enviados).toHaveLength(0);
}

test('desafio interativo: espera além dos 5 s e envia com o token assim que a pessoa resolve', async ({ page }) => {
  await page.clock.install();
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { interativo: true });
  await ateOEnvioComDesafio(page, enviados);
  await page.clock.fastForward(7000); // já passou dos 5 s...
  await page.waitForTimeout(300); // prazo para um envio (errado) sair no corte de 5 s
  expect(enviados).toHaveLength(0); // ...e continua esperando a pessoa
  await expect(dica(page)).toHaveText(DICA);
  await page.evaluate(() => window.__resolverDesafio()); // a pessoa marca a caixa
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
  expect(enviados[0].turnstileToken).toBe('tok-1');
});

test('desafio interativo sem resposta: envia sem token no teto de 120 s', async ({ page }) => {
  await page.clock.install();
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { interativo: true });
  await ateOEnvioComDesafio(page, enviados);
  await page.clock.fastForward(60_000);
  await page.waitForTimeout(300);
  expect(enviados).toHaveLength(0); // 1 minuto depois, ainda esperando
  await page.clock.fastForward(61_000); // 121 s desde o clique: envia sem token (nunca bloqueia)
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
});

test('desafio interativo que dá erro: envia sem token na hora', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { interativo: true });
  await ateOEnvioComDesafio(page, enviados);
  await page.evaluate(() => window.__erroDesafio());
  await expect.poll(() => enviados.length, { timeout: 1500 }).toBe(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  await expect(dica(page)).toHaveCount(0); // a dica saiu junto com o formulário
});

test('navegador sem suporte ao Turnstile: envia sem token na hora', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { semSuporte: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  await confirmar(page);
  await expect.poll(() => enviados.length, { timeout: 1500 }).toBe(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
});

// Ajustes finais, item 1: com a espera de até 120 s, nada pode mudar o que vai
// no corpo — campos e "Começar do zero" ficam travados (inert) durante o
// envio; só o widget do Turnstile segue clicável.
const lerRascunho = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('wpdp-credenciamento-ed8-rascunho') ?? 'null'));
const dentroDeInert = (locator) => locator.evaluate((el) => !!el.closest('[inert]'));

test('durante a espera do anti-robô, campos e "Começar do zero" ficam travados; o widget segue clicável', async ({ page }) => {
  await page.clock.install();
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { interativo: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => lerRascunho(page)).toMatchObject({ etapa: 3, dados: { consentimento: true } });
  await page.reload(); // rascunho na etapa 3: aparece "Começar do zero"
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect.poll(() => renders(page)).toBe(1);
  await confirmar(page);
  await expect(dica(page)).toHaveText(DICA);
  await expect(page.getByRole('button', { name: 'Começar do zero' })).toBeDisabled();
  const autorizacao = page.getByLabel(/Autorizo o Instituto METRIK/);
  expect(await dentroDeInert(autorizacao)).toBe(true);
  expect(await dentroDeInert(page.locator('#verificacao'))).toBe(false);
  await page.locator('#verificacao iframe').click(); // o widget segue clicável
  await autorizacao.uncheck({ timeout: 1000 }).catch(() => {}); // tentar mexer não pega
  await expect(autorizacao).toBeChecked();
  await page.evaluate(() => window.__resolverDesafio());
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
  expect(enviados[0]).toMatchObject({ email: exemplo.email, nome: exemplo.nome, consentimento: true, turnstileToken: 'tok-1' });
});

// Item 1 (defesa extra): num navegador sem `inert` a pessoa ainda conseguiria
// mexer — simulado por script. Antes do POST tudo é validado de novo: algo
// inválido não é enviado (o token não é gasto) e a página mostra o erro.
test('antes do POST valida de novo: o que ficou inválido na espera não é enviado', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { interativo: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  await confirmar(page);
  await expect(dica(page)).toHaveText(DICA);
  await page.evaluate(() => {
    const caixa = document.getElementById('in-consentimento');
    caixa.checked = false;
    caixa.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => window.__resolverDesafio());
  await expect(page.locator('#erro-consentimento')).toHaveText('Para concluir, marque a autorização.');
  await expect(page.getByLabel(/Autorizo o Instituto METRIK/)).toBeFocused(); // formulário já destravado
  await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toBeEnabled();
  expect(enviados).toHaveLength(0);
  expect((await registro(page)).resets).toEqual(['w1']); // token descartado, widget reiniciado
});

// Item 1 (proteção da ordem trava/destrava): erro 400 de campo da mesma etapa
// precisa do formulário já destravado para o foco chegar ao campo.
test('erro 400 de um campo da última etapa: foco no campo, com o formulário já destravado', async ({ page }) => {
  await prepararRotas(page, {
    formularioResposta: COM_CHAVE,
    respostasEnvio: [{ status: 400, json: { ok: false, erro: 'Revise os campos destacados.', campos: { 'respostas.motivacao': 'Texto muito longo.' } } }],
  });
  await servirTurnstile(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  const motivacao = page.locator('[data-pergunta="motivacao"]').getByRole('textbox');
  await expect(page.locator('#erro-respostas-motivacao')).toHaveText('Texto muito longo.');
  await expect(motivacao).toBeFocused();
  expect(await dentroDeInert(motivacao)).toBe(false);
});

// Item 2: widget que já falhou ANTES do clique não custa os 5 s de espera.
test('widget que não chegou a nascer (render lançou erro): envia sem token na hora', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { renderLanca: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  await confirmar(page);
  await expect.poll(() => enviados.length, { timeout: 1500 }).toBe(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
});

test('widget com erro antes do clique: envia sem token na hora', async ({ page }) => {
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { erroAntes: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => page.evaluate(() => (window.__turnstile && window.__turnstile.erros) || 0)).toBe(1);
  await confirmar(page);
  await expect.poll(() => enviados.length, { timeout: 1500 }).toBe(1);
  expect(enviados[0]).not.toHaveProperty('turnstileToken');
});

// Item 3: token vencido zera o desafio — o próximo clique volta à espera de
// 5 s (sem dica), e não fica até 120 s por um modo interativo antigo.
test('token que venceu zera o desafio: o clique seguinte espera só 5 s, sem dica', async ({ page }) => {
  await page.clock.install();
  const enviados = await prepararRotas(page, { formularioResposta: COM_CHAVE });
  await servirTurnstile(page, { interativo: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await expect.poll(() => renders(page)).toBe(1);
  await page.evaluate(() => window.__resolverDesafio()); // resolveu antes de clicar...
  await page.evaluate(() => window.__expirarDesafio()); // ...e o token venceu (a renovação não chegou)
  await confirmar(page);
  await expect(dica(page)).toHaveText('');
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
  await page.locator('[data-pergunta="motivacao"]').getByRole('textbox').fill('Outra motivação'); // grava o rascunho com o token já em memória
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho') || ''))
    .toContain('Outra motivação');
  await confirmar(page);
  await expect(page.getByText('Instabilidade momentânea.')).toBeVisible();
  expect(enviados[0].turnstileToken).toBe('tok-1'); // o token existia em memória
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('tok-');
  expect(await page.evaluate(() => JSON.stringify(window.dataLayer || []))).not.toContain('tok-');
});
