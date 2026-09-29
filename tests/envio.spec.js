// tests/envio.spec.js
import { expect, test } from '@playwright/test';
import { avancarRelogio, exemplo, formulario, prepararRotas, preencherTudo, SUCESSO, URL_TESTE } from './ajudantes.js';

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
  // M-1: o href leva à Central SEM o código do crachá (ver teste abaixo)
  await expect(page.getByRole('link', { name: 'Acessar a Central do Workshop' })).toHaveAttribute('href', 'https://centraldelinks.rodrigorosar.com.br/ed8/');
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

// M-1: o código do crachá (depois de "#acesso=") nunca fica num href nem no
// HTML da página — o GTM/GA4 lê o href dos links clicados (cliques de saída,
// "Just Links"). O link leva à Central sem o código; o clique normal navega
// com o link pessoal completo.
const semCodigoNaPagina = async (page) => {
  expect(await page.locator('[href*="acesso="]').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.outerHTML.includes('acesso='))).toBe(false);
};

test('código do crachá nunca fica em href; o clique em "Acessar a Central" leva ao link pessoal completo', async ({ page }) => {
  await prepararRotas(page);
  await page.route('https://centraldelinks.rodrigorosar.com.br/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Central</title><p>Central do Workshop</p>' }),
  );
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  const central = page.getByRole('link', { name: 'Acessar a Central do Workshop' });
  await expect(central).toHaveAttribute('href', 'https://centraldelinks.rodrigorosar.com.br/ed8/');
  await semCodigoNaPagina(page);
  await central.click();
  await expect(page).toHaveURL(SUCESSO.centralUrl);
});

test('sem e-mail enviado: "Copiar meu link" copia o link pessoal completo', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiado = null;
    const area = { writeText: (t) => { window.__copiado = t; return Promise.resolve(); } };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => area });
  });
  await prepararRotas(page, { respostasEnvio: [{ status: 201, json: { ...SUCESSO, emailEnviado: false } }] });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await page.getByRole('button', { name: 'Copiar meu link' }).click();
  await expect(page.getByRole('button', { name: /Link copiado/ })).toBeVisible();
  expect(await page.evaluate(() => window.__copiado)).toBe(SUCESSO.centralUrl);
  await semCodigoNaPagina(page);
});

test('sem e-mail enviado e sem área de transferência: o link aparece num campo só de leitura, nunca num link', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => undefined });
  });
  await prepararRotas(page, { respostasEnvio: [{ status: 201, json: { ...SUCESSO, emailEnviado: false } }] });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await page.getByRole('button', { name: 'Copiar meu link' }).click();
  const campo = page.getByRole('textbox', { name: 'Seu link pessoal' });
  await expect(campo).toHaveValue(SUCESSO.centralUrl);
  await expect(campo).toHaveAttribute('readonly', '');
  await semCodigoNaPagina(page);
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

// C3: o 400 devolve até 5 chaves escolhidas por quem mandou o pedido
// ("respostas.<qualquer coisa>") — chave que a página não conhece é ignorada,
// e texto do servidor sempre entra como texto, nunca como HTML.
test('erro 400 com chave desconhecida: só o erro do e-mail aparece e nada é injetado', async ({ page }) => {
  const dialogos = [];
  const errosDaPagina = [];
  page.on('dialog', (d) => {
    dialogos.push(d.message());
    return d.dismiss();
  });
  page.on('pageerror', (e) => errosDaPagina.push(e.message));
  await prepararRotas(page, {
    respostasEnvio: [
      {
        status: 400,
        json: {
          ok: false,
          erro: 'Revise os campos destacados.',
          campos: { '<img src=x onerror=alert(1)>': 'x', 'respostas.nao_existe': 'Campo desconhecido.', email: 'E-mail inválido' },
        },
      },
    ],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  await expect(page.locator('#erro-email')).toHaveText('E-mail inválido');
  await expect(page.locator('#aviso-envio')).toHaveText('Revise os campos destacados.'); // nada das chaves desconhecidas
  expect(await page.locator('#app img').count()).toBe(0);
  expect(dialogos).toEqual([]);
  expect(errosDaPagina).toEqual([]);
});

test('erro 400 só com chaves desconhecidas: aviso geral com o suporte, sem sair da etapa', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [{ status: 400, json: { ok: false, erro: 'Revise os campos destacados.', campos: { 'respostas.nao_existe': 'Campo desconhecido.' } } }],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.locator('#aviso-envio')).toContainText('Revise os campos destacados.');
  await expect(page.locator('#aviso-envio')).not.toContainText('Campo desconhecido.');
  await expect(page.getByRole('link', { name: 'Fale com o suporte' })).toBeVisible();
  await expect(page.locator('#aviso-envio')).toBeFocused();
  await expect(page.getByText('Etapa 4 de 4')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toBeEnabled();
});

// C3 (proteção — já era texto): erro e primeiro nome com marcação HTML
// aparecem como texto puro, sem criar elemento nenhum.
test('texto do servidor com marcação HTML aparece como texto, nunca como HTML', async ({ page }) => {
  await prepararRotas(page, {
    respostasEnvio: [
      { status: 429, json: { ok: false, erro: '<img src=x onerror=alert(1)> Muitos envios.' } },
      { status: 201, json: { ...SUCESSO, primeiroNome: '<b>Ana</b>' } },
    ],
  });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.locator('#aviso-envio')).toContainText('<img src=x onerror=alert(1)> Muitos envios.');
  expect(await page.locator('#app img').count()).toBe(0);
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado, <b>Ana<\/b>!/ })).toBeVisible();
  expect(await page.locator('#app b').count()).toBe(0);
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

// I-2 / M-11 / N-1: os dois caminhos do 409 marcam o rascunho com
// `migrar: <edição>` (e todo rascunho guarda a própria `edicao`). Na próxima
// carga, um rascunho marcado de OUTRA versão da MESMA edição é mesclado (não
// descartado) e o marcador fica até o rascunho ser apagado (envio certo, 410,
// "Começar do zero"). Rascunho de outra edição, ou de outra versão sem
// marcador, continua descartado (Review Focus #3, em tela.spec.js).
// O-1: ao mesclar outra versão, a autorização volta desmarcada.
// N-2: rascunho migrado abre na primeira etapa com erro, se vier antes da salva.
const CHAVE_RASCUNHO = 'wpdp-credenciamento-ed8-rascunho';
const lerRascunho = (page) => page.evaluate((chave) => JSON.parse(localStorage.getItem(chave) ?? 'null'), CHAVE_RASCUNHO);
const trocarOpcoes = (etapa, id, opcoes) => ({
  ...formulario,
  versao: 'ed8-v2',
  etapas: formulario.etapas.map((e, i) =>
    i === etapa - 1 ? { ...e, perguntas: e.perguntas.map((p) => (p.id === id ? { ...p, opcoes } : p)) } : e,
  ),
});
const V2 = { ...formulario, versao: 'ed8-v2' }; // só a versão muda
const V2_GENERO = trocarOpcoes(1, 'genero', ['Não-binário', 'Masculino']); // "Feminino" some
const V2_IDADE = trocarOpcoes(2, 'idade', ['Até 30 anos', 'Mais de 30 anos']); // "26 a 35 anos" some
const ED9 = { ...formulario, edicao: 'ed9', versao: 'ed9-v1' };
const ERRO_409 = { status: 409, json: { ok: false, erro: 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.' } };
const autorizacao = (page) => page.getByLabel(/Autorizo o Instituto METRIK/);

/** Rota do cardápio que responde, em ordem, cada item da lista (número = status de erro). */
async function cardapioEmSequencia(page, respostas) {
  let buscas = 0;
  await page.route('**/api/public/credenciamento/formulario*', (r) => {
    const resposta = respostas[Math.min(buscas, respostas.length - 1)];
    buscas += 1;
    return typeof resposta === 'number' ? r.fulfill({ status: resposta, json: {} }) : r.fulfill({ json: resposta });
  });
}

async function recarregarPeloBotao(page) {
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Recarregar a página' }).click()]);
}

test('409 → busca atualizada falha → "Recarregar a página" com o servidor já na v2: respostas ainda válidas continuam', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, 503, V2_GENERO]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('button', { name: 'Recarregar a página' })).toBeVisible();
  expect(await lerRascunho(page)).toMatchObject({ edicao: 'ed8', versao: 'ed8-v1', migrar: 'ed8' });
  await recarregarPeloBotao(page);
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible(); // N-2: "genero" ficou sem resposta válida na v2
  await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toHaveValue(exemplo.email);
  await expect(page.getByLabel('Nome completo')).toHaveValue(exemplo.nome);
  await expect(page.locator('[data-pergunta="acesso_evento"]').getByRole('radio', { name: exemplo.respostas.acesso_evento.opcao, exact: true })).toBeChecked();
  await expect(page.locator('[data-pergunta="genero"] input:checked')).toHaveCount(0); // "Feminino" não existe na v2
  const rascunho = await lerRascunho(page);
  expect(rascunho).toMatchObject({ edicao: 'ed8', versao: 'ed8-v2', migrar: 'ed8' }); // regravado na versão nova; marcador fica
  expect(rascunho.dados.endereco.numero).toBe(exemplo.endereco.numero);
});

test('409 recuperado para a v2 e a recarga ainda recebe a v1 (cache da CDN): nada se perde', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, V2, formulario]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('O formulário foi atualizado. Confira as respostas e envie de novo.')).toBeVisible();
  expect(await lerRascunho(page)).toMatchObject({ versao: 'ed8-v2', migrar: 'ed8' });
  await page.reload();
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByLabel('Número')).toHaveValue(exemplo.endereco.numero);
  const rascunho = await lerRascunho(page);
  expect(rascunho).toMatchObject({ versao: 'ed8-v1', migrar: 'ed8' });
  expect(rascunho.dados.email).toBe(exemplo.email);
  expect(rascunho.dados.respostas.genero).toEqual({ valor: 'Feminino', outro: '' });
});

// I-2 (resto fechado): o marcador NÃO é consumido na mescla — a CDN pode
// alternar as versões entre uma recarga e outra.
test('409 recuperado para a v2, recarga na v1 e de novo na v2: as respostas continuam', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, V2, formulario, V2]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('O formulário foi atualizado. Confira as respostas e envie de novo.')).toBeVisible();
  await page.reload(); // v1 (cache da CDN)
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await page.reload(); // v2 de novo
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByLabel('Número')).toHaveValue(exemplo.endereco.numero);
  const rascunho = await lerRascunho(page);
  expect(rascunho).toMatchObject({ versao: 'ed8-v2', migrar: 'ed8' });
  expect(rascunho.dados.email).toBe(exemplo.email);
  expect(rascunho.dados.respostas.genero).toEqual({ valor: 'Feminino', outro: '' });
});

test('409 → busca falha → recarga ainda na v1 (CDN) guarda o marcador até a v2 chegar', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, 503, formulario, V2]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await recarregarPeloBotao(page);
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await page.getByLabel('Complemento (opcional)').fill('ap 13');
  await expect.poll(() => lerRascunho(page)).toMatchObject({ versao: 'ed8-v1', migrar: 'ed8', dados: { endereco: { complemento: 'ap 13' } } });
  await page.reload();
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByLabel('Complemento (opcional)')).toHaveValue('ap 13');
  const rascunho = await lerRascunho(page);
  expect(rascunho).toMatchObject({ versao: 'ed8-v2', migrar: 'ed8' });
  expect(rascunho.dados.email).toBe(exemplo.email);
});

// N-1: o marcador leva a edição — um rascunho marcado de OUTRA edição é
// descartado como um sem marcador: respostas e autorização nunca passam de
// uma edição para outra.
test('rascunho marcado de outra edição é descartado', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, V2, ED9]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('O formulário foi atualizado. Confira as respostas e envie de novo.')).toBeVisible();
  await page.reload(); // o servidor já está na ed9
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  await expect(page.getByText('Continuamos de onde você parou.')).toHaveCount(0);
  await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toHaveValue('');
  expect(await lerRascunho(page)).toBeNull();
});

// N-1 (mesma raiz): uma edição nova pode reaproveitar a MESMA versão de
// formulário (dashboard edicoes.ts: formularioVersao) — rascunho de outra
// edição é descartado mesmo sem marcador e com a mesma versão.
test('rascunho de outra edição com a mesma versão de formulário é descartado', async ({ page }) => {
  await prepararRotas(page);
  await cardapioEmSequencia(page, [formulario, { ...formulario, edicao: 'ed9' }]);
  await page.goto(URL_TESTE);
  await page.getByLabel('Nome completo').fill('Ana Souza');
  await expect.poll(() => lerRascunho(page)).toMatchObject({ versao: 'ed8-v1', dados: { nome: 'Ana Souza' } });
  await page.reload(); // ed9 com a versão de formulário "ed8-v1"
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  await expect(page.getByText('Continuamos de onde você parou.')).toHaveCount(0);
  await expect(page.getByLabel('Nome completo')).toHaveValue('');
});

// N-1 (mesma raiz): se a busca sem cache do 409 já vier de outra edição, nada
// é mesclado nela — cai no aviso de recarregar, e a recarga descarta o rascunho.
test('409 com o servidor já em outra edição não leva as respostas para lá', async ({ page }) => {
  const enviados = await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, ED9, ED9]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('button', { name: 'Recarregar a página' })).toBeVisible();
  await expect(page.getByText('O formulário foi atualizado. Confira as respostas e envie de novo.')).toHaveCount(0);
  await recarregarPeloBotao(page);
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  await expect(page.getByText('Continuamos de onde você parou.')).toHaveCount(0);
  await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toHaveValue('');
  expect(enviados).toHaveLength(1);
});

// O-1: o texto da autorização vem do servidor e pode ter mudado com a versão —
// ao mesclar outra versão, a autorização volta desmarcada e é pedida de novo.
test('409 recuperado para outra versão pede a autorização de novo', async ({ page }) => {
  const enviados = await prepararRotas(page, { respostasEnvio: [ERRO_409, { status: 201, json: SUCESSO }] });
  await cardapioEmSequencia(page, [formulario, V2]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByText('O formulário foi atualizado. Confira as respostas e envie de novo.')).toBeVisible();
  await expect(page.getByText('Etapa 4 de 4')).toBeVisible();
  await expect(autorizacao(page)).not.toBeChecked();
  await expect(page.locator('#erro-consentimento')).toHaveText('Para concluir, marque a autorização.');
  expect((await lerRascunho(page)).dados.consentimento).toBe(false);
  await autorizacao(page).check();
  await confirmar(page);
  await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
  expect(enviados).toHaveLength(2);
  expect(enviados[1]).toMatchObject({ versao: 'ed8-v2', consentimento: true });
});

test('rascunho migrado de outra versão volta com a autorização desmarcada', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, 503, V2]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await recarregarPeloBotao(page);
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByText('Etapa 4 de 4')).toBeVisible();
  await expect(autorizacao(page)).not.toBeChecked();
  expect(await lerRascunho(page)).toMatchObject({ versao: 'ed8-v2', dados: { consentimento: false } });
});

// N-2: rascunho migrado abre na primeira etapa que ficou com erro quando uma
// resposta de etapa ANTERIOR à salva deixou de valer — e não volta nem pula à
// toa quando nada antes da etapa salva mudou (proteção da regra do mínimo).
test('rascunho migrado abre na primeira etapa que ficou com erro', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, 503, V2_IDADE]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await recarregarPeloBotao(page);
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByText('Etapa 2 de 4')).toBeVisible(); // "idade" mudou de opções na v2
  await expect(page.locator('[data-pergunta="idade"] input:checked')).toHaveCount(0);
  await expect(page.locator('[data-pergunta="formacao"]').getByRole('radio', { name: exemplo.respostas.formacao.opcao, exact: true })).toBeChecked();
});

test('rascunho migrado abre na etapa salva quando nada antes dela ficou inválido', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, 503, V2]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.getByRole('button', { name: 'Recarregar a página' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.getByRole('button', { name: 'Voltar' }).click();
  await expect(page.getByText('Etapa 2 de 4')).toBeVisible();
  await expect.poll(() => lerRascunho(page)).toMatchObject({ etapa: 2 });
  await page.reload();
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByText('Etapa 2 de 4')).toBeVisible(); // nem volta à 1, nem pula para a 4 (autorização desmarcada)
});

// C4 (fixa o que já está certo): "Começar do zero" tira o marcador — depois
// dele, uma recarga já em outra versão descarta o rascunho novo.
test('"Começar do zero" tira o marcador: recarga em outra versão descarta o rascunho', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [ERRO_409] });
  await cardapioEmSequencia(page, [formulario, 503, formulario, V2]);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await recarregarPeloBotao(page); // ainda na v1: o rascunho marcado volta
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Começar do zero' }).click();
  await page.getByLabel('Nome completo').fill('Bia Lima');
  await expect.poll(() => lerRascunho(page)).toMatchObject({ versao: 'ed8-v1', dados: { nome: 'Bia Lima' } });
  expect(await lerRascunho(page)).not.toHaveProperty('migrar');
  await page.reload(); // já na v2
  await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  await expect(page.getByText('Continuamos de onde você parou.')).toHaveCount(0);
  await expect(page.getByLabel('Nome completo')).toHaveValue('');
});

// C4 (fixa o que já está certo): recarga da MESMA versão devolve a
// autorização como estava — só a migração de versão a desmarca (O-1).
test('recarga da mesma versão mantém a autorização marcada', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo); // termina na etapa 4 com a autorização marcada
  await expect.poll(() => lerRascunho(page)).toMatchObject({ etapa: 4, dados: { consentimento: true } });
  await page.reload();
  await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
  await expect(page.getByText('Etapa 4 de 4')).toBeVisible();
  await expect(autorizacao(page)).toBeChecked();
});

// M-2: o envio (POST) espera até ~35 s antes de desistir — em pico o servidor
// pode demorar (banco, e-mail); a carga do formulário (GET) tem prazo
// próprio de 45 s por tentativa (fix "página espera o servidor acordar").
// Relógio falso do Playwright: nada de esperar 35 s de verdade.
const FALHA_ENVIO = 'Não conseguimos registrar agora. Suas respostas estão salvas neste aparelho; tente de novo em instantes.';

test('envio espera até ~35 s pelo servidor antes de desistir', async ({ page }) => {
  await page.clock.install();
  let soltar = () => {};
  const preso = new Promise((resolver) => { soltar = resolver; });
  await prepararRotas(page);
  await page.route('**/api/public/credenciamento', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    await preso; // servidor que não responde
    return r.abort().catch(() => {});
  });
  try {
    await page.goto(URL_TESTE);
    await preencherTudo(page, exemplo);
    await confirmar(page);
    await expect(page.getByRole('button', { name: /Enviando/ })).toBeDisabled();
    await page.clock.fastForward(20_000); // já passou dos 15 s de antes...
    await page.waitForTimeout(300); // prazo para uma desistência (errada) aparecer na tela
    await expect(page.getByRole('button', { name: /Enviando/ })).toBeDisabled(); // ...e o envio segue esperando
    await expect(page.getByText(FALHA_ENVIO)).toHaveCount(0);
    await page.clock.fastForward(16_000); // 36 s: agora desiste
    await expect(page.getByText(FALHA_ENVIO)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toBeEnabled();
  } finally {
    soltar();
  }
});

// Ajustes finais, item 5: o prazo de 35 s vale até o CORPO da resposta ser
// lido. Um corpo que trava depois dos cabeçalhos (aqui: fetch falso com um
// corpo que nunca termina e que respeita o abort, como o de verdade) também
// cai no prazo — antes, "Enviando…" ficava para sempre.
test('resposta que trava depois dos cabeçalhos também cai no prazo de 35 s', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (url, init = {}) => {
      if (!String(url).endsWith('/api/public/credenciamento') || init.method !== 'POST') return original(url, init);
      window.__postsTravados = (window.__postsTravados || 0) + 1;
      let controlador;
      const corpo = new ReadableStream({
        start(c) {
          controlador = c;
          c.enqueue(new TextEncoder().encode('{"ok":'));
        },
      });
      if (init.signal) init.signal.addEventListener('abort', () => controlador.error(new DOMException('Aborted', 'AbortError')));
      return Promise.resolve(new Response(corpo, { status: 201, headers: { 'Content-Type': 'application/json' } }));
    };
  });
  await prepararRotas(page);
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect.poll(() => page.evaluate(() => window.__postsTravados || 0)).toBe(1);
  await expect(page.getByRole('button', { name: /Enviando/ })).toBeDisabled();
  await page.clock.fastForward(36_000);
  await expect(page.getByText(FALHA_ENVIO)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toBeEnabled();
});

// Ajustes finais, item 6: sem primeiro nome válido (o servidor só manda
// quando é uma palavra de letras), o título não fica "confirmado, !".
test('sem primeiro nome válido, o título do sucesso fica só "Credenciamento confirmado!"', async ({ page }) => {
  await prepararRotas(page, { respostasEnvio: [{ status: 201, json: { ...SUCESSO, primeiroNome: null } }] });
  await page.goto(URL_TESTE);
  await preencherTudo(page, exemplo);
  await confirmar(page);
  await expect(page.locator('#titulo-sucesso')).toHaveText('✅ Credenciamento confirmado!');
});

// Fix "página espera o servidor acordar": o prazo da carga do formulário
// agora é 45 s por tentativa, com uma retentativa automática (depois de uma
// pausa de ~1,5 s) antes de desistir (era 15 s, sem retentativa — visto em
// produção, o servidor levou até 38,9 s para responder pela primeira vez
// depois de um deploy do dashboard; o prazo antigo derrubava gente real por
// um problema que se resolvia sozinho em segundos). As duas tentativas
// passam pelo mesmo `preso`: quem desiste é sempre o prazo do CLIENTE
// (relógio falso), nunca o servidor simulado — por isso 16 s (o antigo
// prazo +1 s) já não é mais suficiente para a tela de falha aparecer.
test('carga do formulário só desiste depois de 45 s × 2 tentativas (antes eram 15 s sem retentativa)', async ({ page }) => {
  await page.clock.install();
  let soltar = () => {};
  const preso = new Promise((resolver) => { soltar = resolver; });
  await prepararRotas(page);
  await page.route('**/api/public/credenciamento/formulario*', async (r) => {
    await preso;
    return r.abort().catch(() => {});
  });
  try {
    await page.goto(URL_TESTE);
    await page.clock.fastForward(16_000);
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toHaveCount(0);
    // Passos pequenos (não um salto só): a cadeia prazo → pausa → prazo de
    // novo encadeia com mais confiança assim (ver avancarRelogio em ajudantes.js).
    await avancarRelogio(page, 96_000); // estoura o prazo (45 s) da 1ª tentativa + pausa (1,5 s) + o prazo (45 s) da retentativa
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toBeVisible();
  } finally {
    soltar();
  }
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
