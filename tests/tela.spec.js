// tests/tela.spec.js
import { expect, test } from '@playwright/test';
import { avancar, exemplo, formulario, prepararRotas, preencherEndereco, preencherEtapa1, responderEtapa, URL_TESTE } from './ajudantes.js';

test.describe('montagem e navegação', () => {
  test('monta a etapa 1 a partir do servidor', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
    await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toBeVisible();
    await expect(page.getByText('É por ele que vamos te identificar e enviar seu acesso.')).toBeVisible();
    await expect(page.locator('[data-pergunta="acesso_evento"] legend')).toContainText(formulario.etapas[0].perguntas[0].rotulo);
  });

  test('não avança sem os obrigatórios e leva o foco ao primeiro erro', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await avancar(page);
    await expect(page.locator('#erro-email')).toHaveText('Confira o e-mail: parece que falta algo.');
    await expect(page.locator('#erro-nome')).toHaveText('Preencha este campo.');
    await expect(page.locator('#erro-whatsapp')).toHaveText('Informe o WhatsApp com DDD.');
    await expect(page.locator('#erro-instagram')).toHaveText('Preencha este campo.');
    await expect(page.locator('#erro-respostas-acesso_evento')).toHaveText('Escolha uma opção.');
    await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toBeFocused();
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  });

  test('voltar não perde o que foi preenchido', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await expect(page.getByText('Etapa 2 de 4')).toBeVisible();
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Nome completo')).toHaveValue('Ana Souza');
    await expect(page.locator('[data-pergunta="genero"]').getByRole('radio', { name: 'Feminino', exact: true })).toBeChecked();
  });

  test('WhatsApp ganha máscara enquanto digita', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await page.getByLabel('WhatsApp com DDD').pressSequentially('11912345678');
    await expect(page.getByLabel('WhatsApp com DDD')).toHaveValue('(11) 91234-5678');
  });
});

test.describe('campos especiais', () => {
  test('"Outro" abre campo obrigatório; trocar de opção descarta o texto', async ({ page }) => {
    const enviados = await prepararRotas(page);
    await page.goto(URL_TESTE);
    const genero = page.locator('[data-pergunta="genero"]');
    await preencherEtapa1(page, { ...exemplo, respostas: { acesso_evento: exemplo.respostas.acesso_evento } });
    await genero.getByRole('radio', { name: 'Outro', exact: true }).check();
    await avancar(page);
    await expect(page.locator('#erro-respostas-genero')).toHaveText('Escreva qual é a outra opção.');
    await genero.getByRole('textbox', { name: 'Qual? (Outro)' }).fill('Prefiro não dizer');
    await genero.getByRole('radio', { name: 'Feminino', exact: true }).check();
    await expect(genero.getByRole('textbox', { name: 'Qual? (Outro)' })).toBeHidden();
    await avancar(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await responderEtapa(page, 3, exemplo.respostas);
    await avancar(page);
    await preencherEndereco(page, exemplo.endereco);
    await page.getByLabel(/Autorizo o Instituto METRIK/).check();
    await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
    await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
    expect(enviados[0].respostas.genero).toEqual({ opcao: 'Feminino' });
  });

  test('corretor de e-mail', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    const email = page.getByLabel('E-mail (use o mesmo da compra)');
    await email.fill('ana@gmial.com');
    await email.blur();
    await page.getByRole('button', { name: 'ana@gmail.com' }).click();
    await expect(email).toHaveValue('ana@gmail.com');
  });

  test('"Não tenho Instagram" desativa o campo e dispensa o @', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await page.getByLabel('Não tenho Instagram').check();
    await expect(page.getByLabel('Seu @ no Instagram')).toBeDisabled();
    await avancar(page);
    await expect(page.locator('#erro-instagram')).toBeHidden();
  });

  test('CEP fora do ar não trava: avisa e deixa preencher à mão', async ({ page }) => {
    await prepararRotas(page, { viaCep: 'falha' });
    await page.goto(URL_TESTE);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await responderEtapa(page, 3, exemplo.respostas);
    await avancar(page);
    await page.getByLabel('CEP').fill('01310-100');
    await expect(page.getByText('CEP não encontrado. Preencha o endereço manualmente.')).toBeVisible();
    await expect(page.getByLabel('Rua')).toBeEditable();
  });

  test('"Moro fora do Brasil" troca os campos de endereço', async ({ page }) => {
    const enviados = await prepararRotas(page);
    await page.goto(URL_TESTE);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await responderEtapa(page, 3, exemplo.respostas);
    await avancar(page);
    await page.getByLabel('Moro fora do Brasil').check();
    await expect(page.getByLabel('CEP')).toBeHidden();
    await page.getByLabel('País').fill('Portugal');
    await page.getByLabel('Endereço completo').fill('Rua das Flores 10, 1200-195 Lisboa');
    await page.getByLabel(/Autorizo o Instituto METRIK/).check();
    await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
    await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
    expect(enviados[0].endereco).toEqual({ moraExterior: true, pais: 'Portugal', enderecoCompleto: 'Rua das Flores 10, 1200-195 Lisboa' });
  });
});

test.describe('rascunho e preenchimento pelo link', () => {
  test('rascunho volta depois de recarregar, com aviso e opção de recomeçar', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await page.getByLabel('Nome completo').fill('Ana Souza');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
    await expect(page.getByLabel('Nome completo')).toHaveValue('Ana Souza');
    await page.getByRole('button', { name: 'Começar do zero' }).click();
    await expect(page.getByLabel('Nome completo')).toHaveValue('');
  });

  test('rascunho de versão antiga do formulário é descartado', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('wpdp-credenciamento-ed8-rascunho', JSON.stringify({ versao: 'ed8-v0', etapa: 3, dados: { email: 'velho@exemplo.com.br' } }));
    });
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toHaveValue('');
    await expect(page.getByText('Continuamos de onde você parou.')).toHaveCount(0);
  });

  test('preenche e-mail e nome pelo # e limpa o endereço da página', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE + '#email=ana.souza%40exemplo.com.br&nome=Ana%20Souza');
    await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toHaveValue('ana.souza@exemplo.com.br');
    await expect(page.getByLabel('Nome completo')).toHaveValue('Ana Souza');
    expect(new URL(page.url()).hash).toBe('');
  });
});

test.describe('carga do formulário', () => {
  test('formulário encerrado', async ({ page }) => {
    await prepararRotas(page, { formularioResposta: { ...formulario, aberto: false } });
    await page.goto(URL_TESTE);
    await expect(page.getByRole('heading', { name: 'O credenciamento da 8ª edição foi encerrado.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'rodrigorosar.com.br/suporte' })).toBeVisible();
  });

  test('servidor fora na carga: mensagem e "Tentar de novo" que funciona', async ({ page }) => {
    let tentativas = 0;
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario', (r) => {
      tentativas += 1;
      return tentativas === 1 ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: formulario });
    });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toBeVisible();
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  });
});
