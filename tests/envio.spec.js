// tests/envio.spec.js
import { expect, test } from '@playwright/test';
import { exemplo, prepararRotas, preencherTudo, SUCESSO, URL_TESTE } from './ajudantes.js';

const confirmar = (page) => page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();

test('CONTRATO: o envio é idêntico ao exemplo oficial do servidor', async ({ page }) => {
  const enviados = await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('heading', { name: '✅ Credenciamento confirmado, Ana!' })).toBeVisible();
  expect(enviados).toHaveLength(1);
  const { tempoPreenchimentoS, ...recebido } = enviados[0];
  const { tempoPreenchimentoS: _ignorado, ...esperado } = exemplo;
  expect(recebido).toEqual(esperado);
  expect(Number.isInteger(tempoPreenchimentoS)).toBe(true);
});

test('acento decomposto (NFD) do iPhone: o que a pessoa digitou é o que vai, sem normalizar no cliente', async ({ page }) => {
  // iOS às vezes produz "ç" e "ã" como letra base + acento combinante separado
  // (NFD), em vez de um único caractere acentuado (NFC). A tela não deve mexer
  // nisso: o servidor normaliza. Construído com fromCharCode para não gravar
  // bytes de combinação "crus" e invisíveis neste arquivo-fonte.
  const nfd = 'Concei' + 'c' + String.fromCharCode(0x327) + 'a' + String.fromCharCode(0x303) + 'o Lima';
  expect(nfd).not.toBe(nfd.normalize('NFC'));

  const enviados = await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, { ...exemplo, nome: nfd });
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
  expect(enviados[0].nome).toBe(nfd);
});

test('sucesso: link pessoal, grupo, e-mail enviado e rascunho apagado', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('link', { name: 'Acessar a Central do Workshop' })).toHaveAttribute('href', SUCESSO.centralUrl);
  await expect(page.getByRole('link', { name: 'Entrar no grupo dos participantes' })).toHaveAttribute('target', '_blank');
  await expect(page.getByText('Também enviamos esse link para')).toContainText('ana.souza@exemplo.com.br');
  expect(await page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho'))).toBeNull();
});

test('sucesso sem e-mail enviado: oferece "Copiar meu link"', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [{ status: 201, json: { ...SUCESSO, emailEnviado: false } }] });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Não conseguimos enviar o e-mail agora; vamos tentar de novo nos próximos minutos. Enquanto isso, guarde este link:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copiar meu link' })).toBeVisible();
});

test('erro do servidor em campo de outra etapa leva à etapa certa', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 400, json: { ok: false, erro: 'Revise os campos destacados.', campos: { 'respostas.idade': 'Escolha uma opção.' } } }],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Etapa 2 de 4')).toBeVisible();
  await expect(page.locator('#erro-respostas-idade')).toHaveText('Escolha uma opção.');
});

test('409: pede para recarregar e mantém as respostas', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 409, json: { ok: false, erro: 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.' } }],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recarregar a página' })).toBeVisible();
  const rascunho = JSON.parse((await page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho'))) ?? '{}');
  expect(rascunho.dados.email).toBe('ana.souza@exemplo.com.br');
});

test('falha de rede: mensagem e nada se perde', async ({ page }) => {
  await prepararRotas(page, { envioFalhaRede: true });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Não conseguimos registrar agora. Suas respostas estão salvas neste aparelho; tente de novo em instantes.')).toBeVisible();
  await expect(page.getByLabel('Número')).toHaveValue('1000');
  await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toBeEnabled();
});

test('toque duplo em "Confirmar" gera um envio só', async ({ page }) => {
  const enviados = await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).dblclick();
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(1);
});

test('410 no envio mostra encerrado', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [{ status: 410, json: { ok: false, erro: 'O credenciamento desta edição foi encerrado.' } }] });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('heading', { name: 'O credenciamento da 8ª edição foi encerrado.' })).toBeVisible();
});

test('nenhum dado pessoal vai para o dataLayer', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  const camada = await page.evaluate(() => JSON.stringify(window.dataLayer));
  expect(camada).toContain('credenciamento_enviado');
  for (const pessoal of ['ana.souza', 'Ana Souza', '91234', 'Paulista', 'anasouza']) expect(camada).not.toContain(pessoal);
});
