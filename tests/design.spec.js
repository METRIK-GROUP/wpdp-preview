// tests/design.spec.js
// Refino de design pedido pelo dono (29/09/2026): "tem que ser simples,
// rápido" — perguntas um pouco maiores e mais espaço, mantendo as cores, as
// fontes e o logo da marca. Regras medidas do briefing (ui-ux-pro-max):
// texto das opções >= 16 px, título das perguntas ~18 px, linhas de opção
// com >= 48 px de altura (o mínimo do projeto é 44 px), >= 8 px entre opções,
// >= 28 px entre perguntas, foco visível, sem emoji como ícone, transição
// curta que respeita "reduzir movimento" e nada de rolagem horizontal.
import { expect, test } from '@playwright/test';
import { avancar, campoEmail, exemplo, preencherEtapa1, preencherTudo, prepararRotas, responderEtapa, URL_TESTE } from './ajudantes.js';

const confirmar = (page) => page.getByRole('button', { name: 'Confirmar meu credenciamento' }).click();

/** Abre a página e percorre as 3 etapas, chamando `conferir(page, n)` em cada uma. */
async function emCadaEtapa(page, conferir) {
  await page.goto(URL_TESTE);
  await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
  await conferir(page, 1);
  await preencherEtapa1(page, exemplo);
  await avancar(page);
  await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
  await conferir(page, 2);
  await responderEtapa(page, 2, exemplo.respostas);
  await avancar(page);
  await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
  await conferir(page, 3);
}

/** Medidas (em px) de todos os elementos visíveis do seletor dentro do formulário. */
function medir(page, seletor, propriedade) {
  return page.locator(seletor).evaluateAll(
    (els, prop) =>
      els
        .filter((e) => e.getClientRects().length > 0)
        .map((e) => ({ texto: (e.textContent || e.getAttribute('aria-label') || e.id || '').trim().slice(0, 40), valor: prop === 'altura' ? e.getBoundingClientRect().height : parseFloat(getComputedStyle(e)[prop]) })),
    propriedade,
  );
}

const abaixoDe = (medidas, minimo) => medidas.filter((m) => m.valor < minimo - 0.01);

test.describe('leitura e toque', () => {
  test('linhas de opção, campos e botões com pelo menos 48 px de altura em todas as etapas', async ({ page }) => {
    await prepararRotas(page);
    await emCadaEtapa(page, async (p, n) => {
      const linhas = await medir(p, '#app .opcao, #app .consentimento', 'altura');
      expect(linhas.length, `etapa ${n}: nenhuma linha de opção medida`).toBeGreaterThan(0);
      expect(abaixoDe(linhas, 48), `etapa ${n}`).toEqual([]);
      const controles = await medir(p, '#app input[type=text], #app input[type=email], #app input[type=tel], #app textarea, #app .botao', 'altura');
      expect(abaixoDe(controles, 48), `etapa ${n}`).toEqual([]);
    });
  });

  test('botões de texto (sugestão de e-mail e "Começar do zero") também com 48 px', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await campoEmail(page).fill('ana@gmial.com');
    await campoEmail(page).blur();
    const sugestao = page.getByRole('button', { name: 'ana@gmail.com' });
    await expect(sugestao).toBeVisible();
    expect((await sugestao.boundingBox()).height).toBeGreaterThanOrEqual(48);
    await page.getByLabel('Nome completo').fill('Ana Souza');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('wpdp-credenciamento-ed8-rascunho'))).not.toBeNull();
    await page.reload();
    const comecar = page.getByRole('button', { name: 'Começar do zero' });
    await expect(comecar).toBeVisible();
    expect((await comecar.boundingBox()).height).toBeGreaterThanOrEqual(48);
  });

  test('títulos das perguntas com pelo menos 17 px e texto das opções com pelo menos 16 px', async ({ page }) => {
    await prepararRotas(page);
    await emCadaEtapa(page, async (p, n) => {
      const titulos = await medir(p, '#app .campo__titulo', 'fontSize');
      expect(titulos.length, `etapa ${n}: nenhum título medido`).toBeGreaterThan(0);
      expect(abaixoDe(titulos, 17), `etapa ${n}`).toEqual([]);
      const pesos = await medir(p, '#app .campo__titulo', 'fontWeight');
      expect(abaixoDe(pesos, 600), `etapa ${n}`).toEqual([]);
      // Texto das opções e dos campos de digitar (a bolinha/caixa da opção não tem texto próprio).
      const opcoes = await medir(p, '#app .opcao, #app .consentimento, #app input[type=text], #app input[type=email], #app input[type=tel], #app textarea', 'fontSize');
      expect(abaixoDe(opcoes, 16), `etapa ${n}`).toEqual([]);
      const ajudas = await medir(p, '#app .ajuda, #app .etapa__ajuda, #app .progresso__texto', 'fontSize');
      expect(abaixoDe(ajudas, 14), `etapa ${n}`).toEqual([]);
    });
  });

  test('mensagens de erro com pelo menos 14 px', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await avancar(page); // tudo vazio: erros em todos os obrigatórios
    await expect(page.locator('#erro-email')).toBeVisible();
    const erros = await medir(page, '#app .erro-campo', 'fontSize');
    expect(erros.length).toBeGreaterThan(0);
    expect(abaixoDe(erros, 14)).toEqual([]);
  });

  test('espaço de pelo menos 8 px entre as opções e de pelo menos 28 px entre as perguntas', async ({ page }) => {
    await prepararRotas(page);
    await emCadaEtapa(page, async (p, n) => {
      const r = await p.evaluate(() => {
        const vaos = (els) => els.slice(1).map((e, i) => e.getBoundingClientRect().top - els[i].getBoundingClientRect().bottom);
        const entreOpcoes = [...document.querySelectorAll('#app .opcoes')].flatMap((g) => vaos([...g.querySelectorAll(':scope > .opcao')]));
        const entrePerguntas = vaos([...document.querySelectorAll('#app .perguntas > .campo')]);
        return { entreOpcoes, entrePerguntas };
      });
      expect(r.entrePerguntas.length, `etapa ${n}`).toBeGreaterThan(0);
      expect(Math.min(...r.entrePerguntas), `etapa ${n}: entre perguntas`).toBeGreaterThanOrEqual(28);
      expect(Math.min(...r.entreOpcoes), `etapa ${n}: entre opções`).toBeGreaterThanOrEqual(8);
    });
  });

  test('opção marcada fica diferente de verdade: borda e fundo na cor da marca, além da marca da caixa', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    const bloco = page.locator('[data-pergunta="genero"]');
    const marcada = bloco.locator('.opcao').filter({ hasText: 'Feminino' });
    const outra = bloco.locator('.opcao').filter({ hasText: 'Masculino' });
    await bloco.getByRole('radio', { name: 'Feminino', exact: true }).check();
    await expect(marcada).toHaveCSS('border-top-color', 'rgb(15, 118, 110)');
    const fundo = (l) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await fundo(marcada)).not.toBe(await fundo(outra));
    await expect(outra).toHaveCSS('cursor', 'pointer');
  });

  test('transição curta nas opções (150 a 200 ms) e nenhuma com "reduzir movimento"', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    const opcao = page.locator('#app .opcao').first();
    const duracoes = await opcao.evaluate((e) => getComputedStyle(e).transitionDuration.split(',').map((d) => parseFloat(d)));
    for (const d of duracoes) {
      expect(d).toBeGreaterThanOrEqual(0.15);
      expect(d).toBeLessThanOrEqual(0.2);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduzidas = await opcao.evaluate((e) => getComputedStyle(e).transitionDuration.split(',').map((d) => parseFloat(d)));
    expect(reduzidas.every((d) => d === 0)).toBe(true);
  });

  // Pelo Tab (vale nos 3 motores). No WebKit, andar entre as opções com as
  // setas não liga o :focus-visible nem o anel nativo — é do navegador, não
  // da página; o Tab e a barra de espaço ligam.
  test('foco pelo teclado aparece na linha inteira da opção', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await page.getByLabel('WhatsApp com DDD').focus();
    await page.keyboard.press('Tab'); // 1ª opção da 1ª pergunta, pelo teclado
    const bloco = page.locator('[data-pergunta="acesso_evento"]');
    await expect(bloco.getByRole('radio').first()).toBeFocused();
    const linha = bloco.locator('.opcao').first();
    await expect(linha).toHaveCSS('outline-style', 'solid');
    await expect(linha).toHaveCSS('outline-color', 'rgb(15, 118, 110)');
    await expect(linha).toHaveCSS('outline-width', '2px');
  });
});

test.describe('marca e ícones', () => {
  test('a lista da abertura usa ícone de verdade (SVG), não emoji', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    const itens = page.locator('.intro__lista li');
    await expect(itens).toHaveCount(2);
    await expect(itens.locator('svg[aria-hidden="true"]')).toHaveCount(2);
    const texto = await page.locator('.intro__lista').textContent();
    expect(/\p{Extended_Pictographic}/u.test(texto)).toBe(false);
    await expect(itens.first()).toHaveText('Acesso à Central do Workshop: transmissão, materiais e todos os preparativos');
  });

  test('a tela de sucesso usa ícone de verdade (SVG) no lugar do emoji', async ({ page }) => {
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await preencherTudo(page, exemplo);
    await confirmar(page);
    const titulo = page.getByRole('heading', { name: 'Credenciamento confirmado, Ana!', exact: true });
    await expect(titulo).toBeVisible();
    await expect(page.locator('.sucesso svg[aria-hidden="true"]')).toHaveCount(1);
    expect(/\p{Extended_Pictographic}/u.test(await titulo.textContent())).toBe(false);
  });

  test('no computador, o formulário fica numa coluna confortável (entre 600 e 680 px)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
    const largura = await page.locator('#app').evaluate((e) => e.getBoundingClientRect().width);
    expect(largura).toBeGreaterThanOrEqual(600);
    expect(largura).toBeLessThanOrEqual(680);
  });
});

/**
 * Quanto o conteúdo passa da largura da tela. A página usa overflow-x:hidden
 * no body (que esconderia o problema em vez de resolver), então a medida
 * desliga isso por um instante.
 */
function excedenteHorizontal(page) {
  return page.evaluate(() => {
    const raiz = document.documentElement;
    const antes = [raiz.style.overflowX, document.body.style.overflowX];
    raiz.style.overflowX = 'visible';
    document.body.style.overflowX = 'visible';
    const excedente = raiz.scrollWidth - raiz.clientWidth;
    [raiz.style.overflowX, document.body.style.overflowX] = antes;
    return excedente;
  });
}

test.describe('sem rolagem horizontal', () => {
  test('a 320 px, em todas as etapas, com erros na tela e no sucesso', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await prepararRotas(page);
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
    await avancar(page); // erros na etapa 1
    await expect(page.locator('#erro-email')).toBeVisible();
    expect(await excedenteHorizontal(page), 'etapa 1 com erros').toBeLessThanOrEqual(0);
    await campoEmail(page).fill('ana@gmial.com');
    await campoEmail(page).blur();
    await expect(page.getByRole('button', { name: 'ana@gmail.com' })).toBeVisible();
    expect(await excedenteHorizontal(page), 'etapa 1 com a sugestão de e-mail').toBeLessThanOrEqual(0);
    await preencherEtapa1(page, exemplo);
    await avancar(page);
    await expect(page.getByText('Etapa 2 de 3')).toBeVisible();
    await avancar(page); // erros na etapa 2
    expect(await excedenteHorizontal(page), 'etapa 2 com erros').toBeLessThanOrEqual(0);
    await responderEtapa(page, 2, exemplo.respostas);
    await avancar(page);
    await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
    await confirmar(page); // erros na etapa 3
    expect(await excedenteHorizontal(page), 'etapa 3 com erros').toBeLessThanOrEqual(0);
    await responderEtapa(page, 3, exemplo.respostas);
    await page.getByLabel(/Autorizo o Instituto METRIK/).check();
    expect(await excedenteHorizontal(page), 'etapa 3 preenchida').toBeLessThanOrEqual(0);
    await confirmar(page);
    await expect(page.getByRole('heading', { name: /Credenciamento confirmado/ })).toBeVisible();
    expect(await excedenteHorizontal(page), 'sucesso').toBeLessThanOrEqual(0);
  });

  for (const largura of [375, 768, 1024, 1440]) {
    test(`a ${largura} px, nas etapas 1 e 3`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await prepararRotas(page);
      await page.goto(URL_TESTE);
      await expect(page.getByText('Etapa 1 de 3')).toBeVisible();
      expect(await excedenteHorizontal(page), 'etapa 1').toBeLessThanOrEqual(0);
      await preencherEtapa1(page, exemplo);
      await avancar(page);
      await responderEtapa(page, 2, exemplo.respostas);
      await avancar(page);
      await expect(page.getByText('Etapa 3 de 3')).toBeVisible();
      expect(await excedenteHorizontal(page), 'etapa 3').toBeLessThanOrEqual(0);
    });
  }
});
