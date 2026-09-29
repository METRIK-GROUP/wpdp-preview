// tests/etapas.spec.js
// Decisão do dono (29/09/2026, testando no celular): sem a etapa do endereço
// ("Onde enviar seu prêmio") e sem o campo de Instagram — "tá cansativo
// demais". O servidor segue mandando as 4 etapas ([2, 12, 12, 0] perguntas) e
// os textos antigos de Instagram/endereço durante a transição; a página só
// mostra as etapas que têm perguntas (3), com a autorização e o "Confirmar"
// no fim da última, e nunca manda Instagram nem endereço.
import { expect, test } from '@playwright/test';
import {
  avancar,
  campoEmail,
  CHAVE_RASCUNHO,
  exemplo,
  formulario,
  lerRascunho,
  preencherEtapa1,
  preencherTudo,
  prepararRotas,
  responderEtapa,
  URL_TESTE,
} from './ajudantes.js';

const confirmar = (page) => page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
const confirmado = (page) => page.getByRole('heading', { name: /Credenciamento confirmado/ });
const autorizacao = (page) => page.getByLabel(/Autorizo o Instituto METRIK/);
const barra = (page) => page.getByRole('progressbar', { name: 'Progresso do credenciamento' });

const ROTULOS_QUE_SAIRAM = ['Seu @ no Instagram', 'Não tenho Instagram', 'CEP', 'Rua', 'Número', 'Complemento (opcional)', 'Bairro', 'Cidade', 'Estado', 'País', 'Endereço completo', 'Moro fora do Brasil'];
const CHAVES_QUE_SAIRAM = ['instagram', 'semInstagram', 'sem_instagram', 'endereco', 'moraExterior', 'mora_exterior'];

async function semInstagramNemEndereco(page) {
  for (const rotulo of ROTULOS_QUE_SAIRAM) await expect(page.getByLabel(rotulo, { exact: true })).toHaveCount(0);
  await expect(page.locator('#app')).not.toContainText('Instagram');
  await expect(page.locator('#app')).not.toContainText(formulario.campos.endereco.texto);
  await expect(page.locator('#app')).not.toContainText('Onde enviar seu prêmio');
}

/** Todas as chaves de um objeto, em qualquer nível. */
function todasAsChaves(valor) {
  if (!valor || typeof valor !== 'object') return [];
  return Object.entries(valor).flatMap(([chave, filho]) => [chave, ...todasAsChaves(filho)]);
}

test.describe('três etapas visíveis', () => {
  test('mostra só as etapas com perguntas: "Etapa 1 de 3" a "Etapa 3 de 3", com a barra acompanhando', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
    await expect(barra(page)).toHaveAttribute('aria-valuenow', '33');
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Perfil profissional' })).toBeVisible();
    await expect(barra(page)).toHaveAttribute('aria-valuenow', '67');
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Seu momento' })).toBeVisible();
    await expect(barra(page)).toHaveAttribute('aria-valuenow', '100');
    await expect(page.getByText('100%')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Próximo' })).toHaveCount(0); // a 3ª é a última
    await expect(page.getByText(/de 4/)).toHaveCount(0);
  });

  test('nenhuma etapa tem Instagram nem endereço', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
    await expect(campoEmail(page)).toBeVisible();
    await expect(page.getByLabel('Nome completo')).toBeVisible();
    await expect(page.getByLabel('WhatsApp com DDD')).toBeVisible();
    await semInstagramNemEndereco(page);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
    await semInstagramNemEndereco(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await semInstagramNemEndereco(page);
  });

  // Depois da transição o servidor pode parar de mandar a 4ª etapa e os
  // textos de Instagram/endereço: a página não depende de nenhum dos dois.
  test('cardápio já sem a 4ª etapa e sem os textos de Instagram e endereço funciona igual', async ({ page }) => {
    const campos = Object.fromEntries(Object.entries(formulario.campos).filter(([chave]) => !['instagram', 'endereco'].includes(chave)));
    const semTransicao = { ...formulario, etapas: formulario.etapas.slice(0, 3), campos };
    const enviados = await prepararRotas(page, { formularioResposta: semTransicao });
    await page.goto(URL_TESTE);
    await preencherTudo(page, exemplo);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await confirmar(page);
    await expect(confirmado(page)).toBeVisible();
    const { tempoPreenchimentoS, ...recebido } = enviados[0];
    const { tempoPreenchimentoS: _ignorado, ...esperado } = exemplo;
    expect(recebido).toEqual(esperado);
    expect(Number.isInteger(tempoPreenchimentoS)).toBe(true);
  });

  // "Só as etapas com perguntas" vale para qualquer posição, não só para a
  // última: com a 2ª vazia, a contagem vira "de 2" e as respostas dela não vão.
  test('etapa sem perguntas no meio do cardápio também some, e a contagem acompanha', async ({ page }) => {
    const semAEtapa2 = { ...formulario, etapas: formulario.etapas.map((e, i) => (i === 1 ? { ...e, perguntas: [] } : e)) };
    const enviados = await prepararRotas(page, { formularioResposta: semAEtapa2 });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 2')).toBeVisible();
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await expect(page.getByText('Etapa 2 de 2')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Seu momento' })).toBeVisible();
    await responderEtapa(page, 3, exemplo.respostas);
    await autorizacao(page).check();
    await confirmar(page);
    await expect(confirmado(page)).toBeVisible();
    const esperadas = [...formulario.etapas[0].perguntas, ...formulario.etapas[2].perguntas].map((p) => p.id);
    expect(Object.keys(enviados[0].respostas)).toEqual(esperadas);
  });
});

test.describe('autorização no fim da última etapa', () => {
  test('a autorização e o "Confirmar" só aparecem na etapa 3, depois da última pergunta', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
    await expect(autorizacao(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toHaveCount(0);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
    await expect(autorizacao(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirmar meu credenciamento' })).toHaveCount(0);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await expect(autorizacao(page)).toBeVisible();
    await expect(page.locator('#campo-consentimento')).toHaveText(formulario.campos.consentimento);
    // Ordem na página: última pergunta → autorização → "Confirmar".
    const ordem = await page.evaluate(() => {
      const perguntas = document.querySelectorAll('[data-pergunta]');
      const ultima = perguntas[perguntas.length - 1];
      const caixa = document.getElementById('campo-consentimento');
      const botao = document.getElementById('botao-principal');
      const depois = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { ultima: ultima.getAttribute('data-pergunta'), caixaDepoisDaUltima: depois(ultima, caixa), botaoDepoisDaCaixa: depois(caixa, botao), textoDoBotao: botao.textContent };
    });
    expect(ordem).toEqual({ ultima: 'comprometimento', caixaDepoisDaUltima: true, botaoDepoisDaCaixa: true, textoDoBotao: 'Confirmar meu credenciamento' });
  });

  test('sem marcar a autorização não envia: erro na caixa e foco nela', async ({ page }) => {
    const enviados = await prepararRotas(page);
    await page.goto(URL_TESTE);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await responderEtapa(page, 3, exemplo.respostas);
    await confirmar(page);
    await expect(page.locator('#erro-consentimento')).toHaveText('Para concluir, marque a autorização.');
    await expect(autorizacao(page)).toBeFocused();
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    expect(enviados).toHaveLength(0);
  });
});

test.describe('envio sem Instagram nem endereço', () => {
  test('o corpo do envio tem só as chaves do contrato novo', async ({ page }) => {
    const pedidosViaCep = [];
    page.on('request', (req) => {
      if (req.url().includes('viacep')) pedidosViaCep.push(req.url());
    });
    const enviados = await prepararRotas(page);
    await page.goto(URL_TESTE);
    await preencherTudo(page, exemplo);
    await confirmar(page);
    await expect(confirmado(page)).toBeVisible();
    expect(enviados).toHaveLength(1);
    expect(Object.keys(enviados[0])).toEqual(['edicao', 'versao', 'email', 'nome', 'whatsapp', 'respostas', 'consentimento', 'canal', 'tempoPreenchimentoS', 'empresa_site']);
    expect(todasAsChaves(enviados[0]).filter((c) => CHAVES_QUE_SAIRAM.includes(c))).toEqual([]);
    expect(pedidosViaCep).toEqual([]); // nenhuma chamada a terceiros por causa do endereço
  });
});

// Rascunho gravado pela página ANTERIOR (a que ainda está no ar durante a
// troca): tem Instagram, endereço e pode estar na etapa 4. Precisa voltar sem
// perder nada do que ainda vale — os campos que saíram são ignorados e a
// etapa salva vira a última etapa visível.
const OUTRO = '__outro__';
const todasPerguntas = formulario.etapas.flatMap((e) => e.perguntas);

/** Respostas no formato em que a página grava o rascunho (formato de tela), a partir do exemplo oficial. */
function respostasDeTela(respostas) {
  return Object.fromEntries(
    todasPerguntas.map((p) => {
      const r = respostas[p.id];
      if (p.tipo === 'multipla_escolha') return [p.id, 'opcao' in r ? { valor: r.opcao, outro: '' } : { valor: OUTRO, outro: r.outro }];
      if (p.tipo === 'caixas_selecao') return [p.id, { marcadas: r.opcoes, outroMarcado: r.outro !== null, outro: r.outro ?? '' }];
      return [p.id, r];
    }),
  );
}

function rascunhoDaPaginaAnterior({ etapa = 4, consentimento = true, dados = {} } = {}) {
  return {
    edicao: 'ed8',
    versao: 'ed8-v1',
    etapa,
    inicio: Date.now() - 300_000,
    dados: {
      email: exemplo.email,
      nome: exemplo.nome,
      whatsapp: exemplo.whatsapp,
      instagram: '@anasouza.arq',
      semInstagram: false,
      endereco: { moraExterior: false, cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: 'ap 12', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', pais: '', enderecoCompleto: '' },
      respostas: respostasDeTela(exemplo.respostas),
      consentimento,
      ...dados,
    },
  };
}

async function semearRascunho(page, rascunho) {
  await page.addInitScript(([chave, valor]) => localStorage.setItem(chave, JSON.stringify(valor)), [CHAVE_RASCUNHO, rascunho]);
}

test.describe('rascunho da página anterior', () => {
  test('parado na etapa 4 (endereço): volta na etapa 3, com as respostas, e o envio sai sem Instagram nem endereço', async ({ page }) => {
    await semearRascunho(page, rascunhoDaPaginaAnterior());
    const enviados = await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
    await expect(page.locator('[data-pergunta="motivacao"]').getByRole('textbox')).toHaveValue(exemplo.respostas.motivacao);
    await expect(page.locator('[data-pergunta="comprometimento"]').getByRole('radio', { name: '5', exact: true })).toBeChecked();
    await expect(autorizacao(page)).toBeChecked(); // mesma versão do formulário: a marcação volta como estava
    await semInstagramNemEndereco(page);
    await confirmar(page);
    await expect(confirmado(page)).toBeVisible();
    expect(enviados).toHaveLength(1);
    const { tempoPreenchimentoS, ...recebido } = enviados[0];
    const { tempoPreenchimentoS: _ignorado, ...esperado } = exemplo;
    expect(recebido).toEqual(esperado);
    expect(tempoPreenchimentoS).toBeGreaterThanOrEqual(300); // o início do rascunho antigo continua valendo
  });

  test('os campos que saíram somem do rascunho regravado, e voltar à etapa 1 mostra os contatos sem Instagram', async ({ page }) => {
    await semearRascunho(page, rascunhoDaPaginaAnterior({ dados: { semInstagram: true, instagram: '', endereco: { moraExterior: true, pais: 'Portugal', enderecoCompleto: 'Rua das Flores 10, Lisboa' } } }));
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await page.locator('[data-pergunta="motivacao"]').getByRole('textbox').fill('Quero organizar meu processo.');
    await expect.poll(() => lerRascunho(page)).toMatchObject({ etapa: 3, dados: { respostas: { motivacao: 'Quero organizar meu processo.' } } });
    const rascunho = await lerRascunho(page);
    expect(Object.keys(rascunho.dados).sort()).toEqual(['consentimento', 'email', 'nome', 'respostas', 'whatsapp']);
    expect(todasAsChaves(rascunho).filter((c) => CHAVES_QUE_SAIRAM.includes(c))).toEqual([]);
    await page.getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
    await expect(campoEmail(page)).toHaveValue(exemplo.email);
    await expect(page.getByLabel('WhatsApp com DDD')).toHaveValue(exemplo.whatsapp);
    await semInstagramNemEndereco(page);
  });

  test('parado na etapa 4 sem ter marcado a autorização: volta na etapa 3 pedindo a marcação', async ({ page }) => {
    await semearRascunho(page, rascunhoDaPaginaAnterior({ consentimento: false }));
    const enviados = await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await expect(autorizacao(page)).not.toBeChecked();
    await confirmar(page);
    await expect(page.locator('#erro-consentimento')).toHaveText('Para concluir, marque a autorização.');
    expect(enviados).toHaveLength(0);
    await autorizacao(page).check();
    await confirmar(page);
    await expect(confirmado(page)).toBeVisible();
    expect(enviados).toHaveLength(1);
  });

  test('parado nas etapas 1 a 3: volta na mesma etapa', async ({ page }) => {
    await semearRascunho(page, rascunhoDaPaginaAnterior({ etapa: 2, consentimento: false }));
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
    await expect(page.locator('[data-pergunta="idade"]').getByRole('radio', { name: exemplo.respostas.idade.opcao, exact: true })).toBeChecked();
  });
});
