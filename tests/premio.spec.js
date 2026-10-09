// tests/premio.spec.js
// Página do ganhador de sorteio. API do dashboard e ViaCEP são falsos.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const URL_PAGINA = '/premio/';
const API = 'https://dashboard.rodrigorosar.com.br/api/public/premio';
const VIACEP = 'https://viacep.com.br/ws/**';

/** Rotas falsas; devolve a lista de corpos enviados para a API. */
async function prepararRotas(page, resposta = { status: 201, body: { ok: true, primeiroNome: 'Ana' } }) {
  const enviados = [];
  await page.route(API, async (route) => {
    enviados.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ status: resposta.status, contentType: 'application/json', body: JSON.stringify(resposta.body) });
  });
  await page.route(VIACEP, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' }),
    }),
  );
  return enviados;
}

async function preencherDados(page) {
  await page.getByLabel('Nome completo').fill('Ana Souza');
  await page.getByLabel('Seu @ do Instagram').fill('@Ana.Souza');
  await page.getByLabel('E-mail').fill('ana@exemplo.com');
  await page.getByLabel('WhatsApp com DDD').fill('11912345678');
}

async function semViolacoesGraves(page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto(URL_PAGINA);
  await page.evaluate(() => localStorage.clear());
});

test('estrutura: noindex, prévia do link, logo prioritário e título', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_PAGINA);
  await expect(page).toHaveTitle('Seu prêmio · Workshop PDP + IA');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /ganhou um livro/);
  const logo = page.locator('header img');
  await expect(logo).toHaveAttribute('fetchpriority', 'high');
  expect(await logo.getAttribute('loading')).toBeNull();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Parabéns, você ganhou um livro! 🎁');
  await expect(page.getByRole('button', { name: 'Enviar meu endereço' })).toBeVisible();
});

test('CEP preenche o endereço e o envio mostra a confirmação', async ({ page }) => {
  const enviados = await prepararRotas(page);
  await page.goto(URL_PAGINA);
  await preencherDados(page);
  await page.getByLabel('CEP').fill('01310100');
  await expect(page.getByLabel('CEP')).toHaveValue('01310-100');
  await expect(page.getByLabel('Rua / avenida')).toHaveValue('Avenida Paulista');
  await expect(page.getByLabel('Cidade')).toHaveValue('São Paulo');
  await expect(page.getByLabel('Estado')).toHaveValue('SP');
  await expect(page.getByLabel('Número')).toBeFocused();
  await page.getByLabel('Número').fill('1000');
  await page.getByLabel(/Complemento/).fill('apto 12');
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();

  await expect(page.getByRole('heading', { name: 'Prontinho, Ana!' })).toBeVisible();
  expect(enviados).toHaveLength(1);
  expect(enviados[0]).toMatchObject({
    nome: 'Ana Souza',
    email: 'ana@exemplo.com',
    whatsapp: '(11) 91234-5678',
    instagram: '@ana.souza',
    consentimento: true,
    endereco: {
      moraExterior: false, cep: '01310-100', logradouro: 'Avenida Paulista', numero: '1000',
      complemento: 'apto 12', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP',
    },
  });
  expect(enviados[0]).not.toHaveProperty('empresa_site');
  expect(Number.isInteger(enviados[0].tempoPreenchimentoS)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('premio-rascunho-v1'))).toBeNull();
});

test('validação na tela: mostra erros, foca o primeiro e não envia', async ({ page }) => {
  const enviados = await prepararRotas(page);
  await page.goto(URL_PAGINA);
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();
  await expect(page.getByLabel('Nome completo')).toBeFocused();
  await expect(page.getByLabel('Nome completo')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#erro-endereco-cep')).toHaveText('Informe um CEP com 8 números.');
  await expect(page.locator('#erro-consentimento')).toHaveText('Para enviar, marque a autorização.');
  await expect(page.getByRole('alert')).toContainText('Confira os campos destacados.');
  expect(enviados).toHaveLength(0);
  await semViolacoesGraves(page);
  // Corrigir o campo apaga o erro dele.
  await page.getByLabel('Nome completo').fill('Ana Souza');
  await expect(page.getByLabel('Nome completo')).not.toHaveAttribute('aria-invalid', 'true');
});

test('erro por campo vindo do servidor aparece no campo certo', async ({ page }) => {
  await prepararRotas(page, { status: 400, body: { ok: false, erro: 'Confira os campos destacados.', campos: { email: 'Confira o e-mail: parece que falta algo.' } } });
  await page.goto(URL_PAGINA);
  await preencherDados(page);
  await page.getByLabel('CEP').fill('01310100');
  await expect(page.getByLabel('Rua / avenida')).toHaveValue('Avenida Paulista');
  await page.getByLabel('Número').fill('1000');
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();
  await expect(page.locator('#erro-email')).toHaveText('Confira o e-mail: parece que falta algo.');
  await expect(page.getByLabel('E-mail')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Enviar meu endereço' })).toBeEnabled();
});

test('falha do servidor: mensagem amigável e dados continuam na tela', async ({ page }) => {
  await prepararRotas(page, { status: 500, body: { ok: false, erro: 'Não conseguimos registrar agora.' } });
  await page.goto(URL_PAGINA);
  await preencherDados(page);
  await page.getByLabel('CEP').fill('01310100');
  await expect(page.getByLabel('Rua / avenida')).toHaveValue('Avenida Paulista');
  await page.getByLabel('Número').fill('1000');
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();
  await expect(page.getByRole('alert')).toContainText('Não conseguimos registrar agora.');
  await expect(page.getByLabel('Nome completo')).toHaveValue('Ana Souza');
});

test('morador do exterior: troca os campos e envia país e endereço livre', async ({ page }) => {
  const enviados = await prepararRotas(page);
  await page.goto(URL_PAGINA);
  await preencherDados(page);
  await page.getByLabel('Moro fora do Brasil').check();
  await expect(page.getByLabel('CEP')).toBeHidden();
  await page.getByLabel('País').fill('Portugal');
  await page.getByLabel('Endereço completo').fill('Rua Augusta 100, 1100-053 Lisboa');
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();
  await expect(page.getByRole('heading', { name: 'Prontinho, Ana!' })).toBeVisible();
  expect(enviados[0].endereco).toEqual({ moraExterior: true, pais: 'Portugal', enderecoCompleto: 'Rua Augusta 100, 1100-053 Lisboa' });
});

test('rascunho: o que foi digitado volta depois de recarregar', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_PAGINA);
  await preencherDados(page);
  await page.reload();
  await expect(page.getByLabel('Nome completo')).toHaveValue('Ana Souza');
  await expect(page.getByLabel('E-mail')).toHaveValue('ana@exemplo.com');
});

test('rascunho guarda o tempo já gasto: quem volta e envia rápido não parece robô', async ({ page }) => {
  const enviados = await prepararRotas(page);
  await page.goto(URL_PAGINA);
  await page.evaluate(() => localStorage.setItem('premio-rascunho-v1', JSON.stringify({
    exterior: false, tempoS: 90, nome: 'Ana Souza', instagram: '@ana', email: 'ana@exemplo.com',
    whatsapp: '(11) 91234-5678', cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000',
    complemento: '', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', pais: '', 'endereco-completo': '',
  })));
  await page.reload();
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();
  await expect(page.getByRole('heading', { name: 'Prontinho, Ana!' })).toBeVisible();
  expect(enviados[0].tempoPreenchimentoS).toBeGreaterThanOrEqual(90);
});

test('erro do servidor sem campo na tela vira aviso geral', async ({ page }) => {
  await prepararRotas(page, { status: 400, body: { ok: false, erro: 'Confira os campos destacados.', campos: { corpo: 'Valor inválido.' } } });
  await page.goto(URL_PAGINA);
  await preencherDados(page);
  await page.getByLabel('CEP').fill('01310100');
  await expect(page.getByLabel('Rua / avenida')).toHaveValue('Avenida Paulista');
  await page.getByLabel('Número').fill('1000');
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();
  await expect(page.getByRole('alert')).toContainText('Não conseguimos ler o envio.');
});

test('acessibilidade da página inicial e da confirmação', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_PAGINA);
  await semViolacoesGraves(page);
  await preencherDados(page);
  await page.getByLabel('CEP').fill('01310100');
  await expect(page.getByLabel('Rua / avenida')).toHaveValue('Avenida Paulista');
  await page.getByLabel('Número').fill('1000');
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
  await page.getByRole('button', { name: 'Enviar meu endereço' }).click();
  await expect(page.getByRole('heading', { name: 'Prontinho, Ana!' })).toBeFocused();
  await semViolacoesGraves(page);
});

test('celular: sem rolagem horizontal', async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_PAGINA);
  const largura = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(largura[0]).toBeLessThanOrEqual(largura[1]);
});
