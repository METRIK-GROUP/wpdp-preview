// tests/envio.spec.js
import { expect, test } from '@playwright/test';
import { exemplo, formulario, prepararRotas, preencherTudo, SUCESSO, URL_TESTE } from './ajudantes.js';

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

// I-3: grupoUrl passa pela mesma checagem de esquema que centralUrl — nunca
// confiar cegamente numa URL vinda do servidor.
test('grupoUrl com esquema perigoso não vira link', async ({ page }) => {
  await prepararRotas(page, { formularioResposta: { ...formulario, grupoUrl: 'javascript:alert(1)' } });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entrar no grupo dos participantes' })).toHaveCount(0);
});

// M-7: mesma checagem para centralUrl — mesmo com 201 "de sucesso", uma URL
// fora de https:// nunca vira link clicável nem telas de sucesso.
test('centralUrl com esquema perigoso nunca vira link (mesmo com 201)', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 201, json: { ok: true, primeiroNome: 'Ana', centralUrl: 'javascript:alert(1)', emailEnviado: true } }],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('link', { name: 'Acessar a Central do Workshop' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toHaveCount(0);
  await expect(page.getByText('Não conseguimos registrar agora. Suas respostas estão salvas neste aparelho; tente de novo em instantes.')).toBeVisible();
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

// M-1: chave de erro sem campo correspondente na tela ("corpo", formato
// inválido do corpo da requisição) não pode tentar navegar para etapa
// nenhuma nem travar — mostra a mensagem no aviso geral, com o link de
// suporte, e foca o aviso.
test('erro de "corpo" (sem campo na tela) aparece no aviso geral, sem travar', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 400, json: { ok: false, erro: 'Revise os campos destacados.', campos: { corpo: 'Valor inválido.' } } }],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Etapa 4 de 4')).toBeVisible(); // não navegou para lugar nenhum
  await expect(page.getByText('Valor inválido.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fale com o suporte' })).toBeVisible();
  await expect(page.locator('#aviso-envio')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toBeEnabled();
});

// I-1: 409 não pede mais para recarregar de cara — busca o cardápio
// atualizado (sem cache) e mescla o que ainda é válido. A segunda pergunta
// de "gênero" muda de opções no v2 (perde "Feminino"): a resposta antiga
// precisa cair fora sem quebrar nada, enquanto e-mail/nome (ainda válidos)
// continuam lá.
test('409: busca o formulário atualizado sem recarregar e mantém o que ainda é válido', async ({ page }) => {
  const v2 = {
    ...formulario,
    versao: 'ed8-v2',
    etapas: formulario.etapas.map((e, i) =>
      i === 0 ? { ...e, perguntas: e.perguntas.map((p) => (p.id === 'genero' ? { ...p, opcoes: ['Não-binário', 'Masculino'] } : p)) } : e,
    ),
  };
  await prepararRotas(page, {
    respostasEnvio: [{ status: 409, json: { ok: false, erro: 'O formulário foi atualizado.' } }],
  });
  let tentativas = 0;
  await page.route('**/api/public/credenciamento/formulario*', (r) => {
    tentativas += 1;
    return r.fulfill({ json: tentativas === 1 ? formulario : v2 });
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('O formulário foi atualizado. Confira as respostas e envie de novo.')).toBeVisible();
  await expect(page.locator('#aviso-envio')).toBeFocused();
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible(); // genero (obrigatório) ficou sem resposta válida
  await expect(page.locator('#erro-respostas-genero')).toHaveText('Escolha uma opção.');
  await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toHaveValue(exemplo.email);
  await expect(page.getByLabel('Nome completo')).toHaveValue(exemplo.nome);
  const rascunho = JSON.parse((await page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho'))) ?? '{}');
  expect(rascunho.versao).toBe('ed8-v2');
  expect(rascunho.dados.email).toBe(exemplo.email);
});

// Fix round 2 (Important): a busca do formulário atualizado no 409 é
// assíncrona — enquanto ela não termina, o botão precisa continuar
// desabilitado (senão um segundo clique dispara um novo envio com
// estado.formulario desatualizado, concorrendo com a própria recuperação).
test('409: botão fica desabilitado até a recuperação terminar (sem segundo envio)', async ({ page }) => {
  const enviados = await prepararRotas(page, {
    respostasEnvio: [{ status: 409, json: { ok: false, erro: 'O formulário foi atualizado.' } }],
  });
  let tentativas = 0;
  await page.route('**/api/public/credenciamento/formulario*', async (r) => {
    tentativas += 1;
    if (tentativas > 1) await new Promise((resolver) => setTimeout(resolver, 1000));
    return r.fulfill({ json: formulario });
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  const botao = page.getByRole('button', { name: /Confirmar meu credenciamento|Enviando/ });
  // Espera bem menos que o atraso de 1s da busca — se o botão já reabilitou
  // aqui, é a recuperação assíncrona do 409 "vazando" antes de terminar
  // (checar toBeDisabled() logo após o clique é frágil: nos engines mais
  // rápidos o poll do Playwright pode cair, por sorte, antes do reabilita
  // prematuro do bug — o problema é justamente essa corrida).
  await page.waitForTimeout(300);
  await expect(botao).toBeDisabled();
  await botao.click({ force: true }); // tenta clicar mesmo desabilitado, durante a busca de 1s
  await expect(page.getByText('O formulário foi atualizado. Confira as respostas e envie de novo.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toBeEnabled();
  expect(enviados).toHaveLength(1); // só o POST original — nada de segundo envio
});

test('409: se a busca do formulário atualizado falhar, cai no aviso de recarregar', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 409, json: { ok: false, erro: 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.' } }],
  });
  let tentativas = 0;
  await page.route('**/api/public/credenciamento/formulario*', (r) => {
    tentativas += 1;
    return tentativas === 1 ? r.fulfill({ json: formulario }) : r.fulfill({ status: 503, json: {} });
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recarregar a página' })).toBeVisible();
  await expect(page.locator('#aviso-envio')).toBeFocused();
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
  await expect(page.locator('#aviso-envio')).toBeFocused(); // M-3
});

// M-4: além do botão "Confirmar" reabilitado, o aviso ganha o seu próprio
// "Tentar de novo" que reenvia sem precisar rolar até o fim do formulário.
test('falha de rede: "Tentar de novo" no aviso reenvia', async ({ page }) => {
  let tentativas = 0;
  await prepararRotas(page);
  await page.route('**/api/public/credenciamento', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    tentativas += 1;
    if (tentativas === 1) return r.abort('internetdisconnected');
    return r.fulfill({ status: 201, json: SUCESSO });
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Não conseguimos registrar agora. Suas respostas estão salvas neste aparelho; tente de novo em instantes.')).toBeVisible();
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
});

// M-7: 429 mostra o texto que o servidor mandou (mesma mensagem do contrato
// do servidor, spec seção 7.3).
test('429 mostra o texto do servidor', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 429, json: { ok: false, erro: 'Muitos envios para este e-mail. Tente de novo mais tarde.' } }],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Muitos envios para este e-mail. Tente de novo mais tarde.')).toBeVisible();
  await expect(page.locator('#aviso-envio')).toBeFocused();
});

// M-7: 5xx sem corpo JSON (ex.: página de erro do proxy/CDN) não pode
// travar a tela nem lançar exceção — cai na mensagem padrão amigável.
test('5xx sem corpo JSON mostra mensagem amigável, sem travar', async ({ page }) => {
  await prepararRotas(page);
  await page.route('**/api/public/credenciamento', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    return r.fulfill({ status: 500, contentType: 'text/html', body: '<html>erro interno</html>' });
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Não conseguimos registrar agora. Suas respostas estão salvas neste aparelho; tente de novo em instantes.')).toBeVisible();
  await expect(page.locator('#aviso-envio')).toBeFocused();
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
  await expect(page.locator('#titulo-encerrado')).toBeFocused(); // M-3
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
