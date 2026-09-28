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

  // M-3: quando "Outro" fica sem preencher, o foco vai para a própria caixa
  // de texto — não para a primeira opção da lista, que não ajuda em nada.
  test('"Outro" com erro foca a caixa de texto, não a primeira opção', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    const genero = page.locator('[data-pergunta="genero"]');
    await preencherEtapa1(page, { ...exemplo, respostas: { acesso_evento: exemplo.respostas.acesso_evento } });
    await genero.getByRole('radio', { name: 'Outro', exact: true }).check();
    await avancar(page);
    const outro = genero.getByRole('textbox', { name: 'Qual? (Outro)' });
    await expect(outro).toBeFocused();
    await expect(outro).toHaveAttribute('aria-describedby', 'erro-respostas-genero');
  });

  // M-3 (WCAG 3.2.2): selecionar "Outro" pelas setas do teclado só revela a
  // caixa de texto — nunca rouba o foco da pessoa para lá sozinho.
  test('selecionar "Outro" pelas setas do teclado não move o foco para a caixa de texto', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    const genero = page.locator('[data-pergunta="genero"]');
    await genero.getByRole('radio', { name: 'Feminino', exact: true }).focus();
    await page.keyboard.press('ArrowDown'); // Masculino
    await page.keyboard.press('ArrowDown'); // Outro
    await expect(genero.getByRole('radio', { name: 'Outro', exact: true })).toBeChecked();
    await expect(genero.getByRole('textbox', { name: 'Qual? (Outro)' })).toBeVisible();
    await expect(genero.getByRole('textbox', { name: 'Qual? (Outro)' })).not.toBeFocused();
    await expect(genero.getByRole('radio', { name: 'Outro', exact: true })).toBeFocused();
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

  // M-5: uma resposta lenta do ViaCEP não pode pisar em cima do que a
  // pessoa já digitou enquanto esperava.
  test('CEP: resposta lenta não sobrescreve o que a pessoa já digitou', async ({ page }) => {
    await prepararRotas(page);
    await page.route('https://viacep.com.br/ws/**', async (r) => {
      await new Promise((resolver) => setTimeout(resolver, 800));
      return r.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        json: { cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' },
      });
    });
    await page.goto(URL_TESTE);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await responderEtapa(page, 3, exemplo.respostas);
    await avancar(page);
    const resposta = page.waitForResponse((res) => res.url().includes('viacep.com.br'));
    await page.getByLabel('CEP').fill('01310-100');
    await page.getByLabel('Rua').fill('Rua Digitada Pela Pessoa');
    await resposta;
    await expect(page.getByText('Endereço encontrado. Confira e informe o número.')).toBeVisible();
    await expect(page.getByLabel('Rua')).toHaveValue('Rua Digitada Pela Pessoa');
  });

  // M-5: depois de uma falha, digitar o MESMO CEP de novo precisa tentar de
  // novo (e não ficar preso por já ter sido "o último CEP buscado").
  test('CEP: falha permite tentar de novo com o mesmo CEP', async ({ page }) => {
    await prepararRotas(page);
    let tentativas = 0;
    await page.route('https://viacep.com.br/ws/**', (r) => {
      tentativas += 1;
      return tentativas === 1
        ? r.abort('failed')
        : r.fulfill({
            headers: { 'Access-Control-Allow-Origin': '*' },
            json: { cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' },
          });
    });
    await page.goto(URL_TESTE);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await responderEtapa(page, 3, exemplo.respostas);
    await avancar(page);
    await page.getByLabel('CEP').fill('01310-100');
    await expect(page.getByText('CEP não encontrado. Preencha o endereço manualmente.')).toBeVisible();
    await page.getByLabel('CEP').fill('');
    await page.getByLabel('CEP').fill('01310-100');
    await expect(page.getByLabel('Rua')).toHaveValue('Avenida Paulista');
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
    // M-7: espera o rascunho realmente ser gravado (poll no localStorage),
    // em vez de um tempo fixo arbitrário.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho'))).not.toBeNull();
    await page.reload();
    await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
    await expect(page.getByLabel('Nome completo')).toHaveValue('Ana Souza');
    page.once('dialog', (d) => d.accept()); // M-2: "Começar do zero" agora pede confirmação
    await page.getByRole('button', { name: 'Começar do zero' }).click();
    await expect(page.getByLabel('Nome completo')).toHaveValue('');
  });

  test('"Começar do zero" pede confirmação antes de apagar', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await page.getByLabel('Nome completo').fill('Ana Souza');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho'))).not.toBeNull();
    await page.reload();
    await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Começar do zero' }).click();
    await expect(page.getByLabel('Nome completo')).toHaveValue('Ana Souza'); // recusou: nada foi apagado
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

  // I-2: o "#email=...&nome=..." precisa sumir do endereço ANTES de
  // qualquer busca ao servidor — mesmo que essa busca demore, feche ou
  // falhe — para nunca ficar exposto (histórico do navegador, GTM).
  test('hash com e-mail/nome some mesmo com o formulário demorando para responder', async ({ page }) => {
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', async (r) => {
      await new Promise((resolver) => setTimeout(resolver, 2000));
      return r.fulfill({ json: formulario });
    });
    await page.goto(URL_TESTE + '#email=ana.souza%40exemplo.com.br&nome=Ana%20Souza', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).hash).toBe('');
  });

  test('hash com e-mail/nome some mesmo com o credenciamento encerrado', async ({ page }) => {
    await prepararRotas(page, { formularioResposta: { ...formulario, aberto: false } });
    await page.goto(URL_TESTE + '#email=ana.souza%40exemplo.com.br&nome=Ana%20Souza');
    await expect(page.getByRole('heading', { name: 'O credenciamento da 8ª edição foi encerrado.' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
  });

  test('hash com e-mail/nome some mesmo quando o formulário falha ao carregar', async ({ page }) => {
    await prepararRotas(page, { formularioStatus: 503 });
    await page.goto(URL_TESTE + '#email=ana.souza%40exemplo.com.br&nome=Ana%20Souza');
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
  });

  // M-6: rascunho com "etapa" quebrada (não inteira) — de uma gravação
  // parcial ou de um formato antigo — não pode virar uma etapa inválida
  // nem quebrar a página.
  test('rascunho com etapa não inteira (corrompida) não quebra a página', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'wpdp-credenciamento-ed8-rascunho',
        JSON.stringify({ versao: 'ed8-v1', etapa: 2.5, dados: { email: 'ana@exemplo.com.br' } }),
      );
    });
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 2 de 4')).toBeVisible(); // Math.trunc(2.5) = 2
    await expect(page.getByText('Continuamos de onde você parou.')).toBeVisible();
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('E-mail (use o mesmo da compra)')).toHaveValue('ana@exemplo.com.br');
  });
});

test.describe('carga do formulário', () => {
  test('formulário encerrado', async ({ page }) => {
    await prepararRotas(page, { formularioResposta: { ...formulario, aberto: false } });
    await page.goto(URL_TESTE);
    await expect(page.getByRole('heading', { name: 'O credenciamento da 8ª edição foi encerrado.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'rodrigorosar.com.br/suporte' })).toBeVisible();
    await expect(page.locator('#titulo-encerrado')).toBeFocused(); // M-3
  });

  test('servidor fora na carga: mensagem e "Tentar de novo" que funciona', async ({ page }) => {
    let tentativas = 0;
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', (r) => {
      tentativas += 1;
      return tentativas === 1 ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: formulario });
    });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toBeVisible();
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  });
});

// M-2: alvo de toque de pelo menos 44px (restrição do projeto — mais
// rigorosa que a regra de 24px do axe/WCAG 2.2 usada em tests/acessibilidade.spec.js).
test.describe('alvos de toque (44px)', () => {
  async function alturaDoAlvo(locator) {
    const caixa = await locator.boundingBox();
    expect(caixa).not.toBeNull();
    return caixa.height;
  }

  test('botão da sugestão de e-mail', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    const email = page.getByLabel('E-mail (use o mesmo da compra)');
    await email.fill('ana@gmial.com');
    await email.blur();
    const sugestao = page.getByRole('button', { name: 'ana@gmail.com' });
    await expect(sugestao).toBeVisible();
    expect(await alturaDoAlvo(sugestao)).toBeGreaterThanOrEqual(44);
  });

  test('botão "Começar do zero"', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await page.getByLabel('Nome completo').fill('Ana Souza');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho'))).not.toBeNull();
    await page.reload();
    const comecar = page.getByRole('button', { name: 'Começar do zero' });
    await expect(comecar).toBeVisible();
    expect(await alturaDoAlvo(comecar)).toBeGreaterThanOrEqual(44);
  });

  test('botão "Recarregar a página" (fallback do 409)', async ({ page }) => {
    await prepararRotas(page, {
      respostasEnvio: [{ status: 409, json: { ok: false, erro: 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.' } }],
    });
    let tentativas = 0;
    await page.route('**/api/public/credenciamento/formulario*', (r) => {
      tentativas += 1;
      return tentativas === 1 ? r.fulfill({ json: formulario }) : r.fulfill({ status: 503, json: {} });
    });
    await page.goto(URL_TESTE);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await responderEtapa(page, 3, exemplo.respostas);
    await avancar(page);
    await preencherEndereco(page, exemplo.endereco);
    await page.getByLabel(/Autorizo o Instituto METRIK/).check();
    await page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();
    const recarregar = page.getByRole('button', { name: 'Recarregar a página' });
    await expect(recarregar).toBeVisible();
    expect(await alturaDoAlvo(recarregar)).toBeGreaterThanOrEqual(44);
  });

  test('link "Falar com o suporte" (falha ao carregar)', async ({ page }) => {
    await prepararRotas(page, { formularioStatus: 503 });
    await page.goto(URL_TESTE);
    // exact:true — o rodapé da página também tem um link "Falar com o
    // suporte" (dentro de "Precisa de ajuda? Falar com o suporte").
    const suporte = page.getByRole('link', { name: 'Falar com o suporte', exact: true });
    await expect(suporte).toBeVisible();
    expect(await alturaDoAlvo(suporte)).toBeGreaterThanOrEqual(44);
  });
});
