// tests/ajudantes.js
// Rotas simuladas do dashboard e do ViaCEP + preenchimento a partir do exemplo oficial.
import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';

export const formulario = JSON.parse(readFileSync(new URL('./fixtures/formulario-ed8.json', import.meta.url), 'utf8'));
export const exemplo = JSON.parse(readFileSync(new URL('./fixtures/contrato-exemplo.json', import.meta.url), 'utf8'));

/** Mesma origem da página: o servidor simulado responde em localhost:4173 (sem CORS no teste). */
export const URL_TESTE = '/credenciamento/?api=http://localhost:4173&utm_source=grupo';

export const SUCESSO = {
  ok: true,
  primeiroNome: 'Ana',
  centralUrl: 'https://centraldelinks.rodrigorosar.com.br/ed8/#acesso=abc_DEF-123',
  emailEnviado: true,
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ formularioResposta?: object, formularioStatus?: number, respostasEnvio?: Array<{status:number, json?:object}>, envioFalhaRede?: boolean, viaCep?: 'ok'|'falha' }} [opcoes]
 */
export async function prepararRotas(page, opcoes = {}) {
  const enviados = [];
  const fila = [...(opcoes.respostasEnvio ?? [{ status: 201, json: SUCESSO }])];
  await page.route('https://gtm.rodrigorosar.com.br/**', (r) => r.abort());
  // "*" no fim casa também com a busca sem cache do 409 (I-1), que acrescenta
  // "?_=<timestamp>" na URL para furar o cache da CDN.
  await page.route('**/api/public/credenciamento/formulario*', (r) =>
    r.fulfill({ status: opcoes.formularioStatus ?? 200, json: opcoes.formularioResposta ?? formulario }),
  );
  await page.route('**/api/public/credenciamento', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    enviados.push(JSON.parse(r.request().postData() ?? '{}'));
    if (opcoes.envioFalhaRede) return r.abort('internetdisconnected');
    const resposta = fila.length > 1 ? fila.shift() : fila[0];
    return r.fulfill({ status: resposta.status, json: resposta.json ?? {} });
  });
  await page.route('https://viacep.com.br/ws/**', (r) =>
    opcoes.viaCep === 'falha'
      ? r.abort('failed')
      : r.fulfill({
          headers: { 'Access-Control-Allow-Origin': '*' },
          json: { cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' },
        }),
  );
  return enviados;
}

export async function preencherEtapa1(page, ex) {
  await page.getByLabel('E-mail (use o mesmo da compra)').fill(ex.email);
  await page.getByLabel('Nome completo').fill(ex.nome);
  await page.getByLabel('WhatsApp com DDD').fill(ex.whatsapp);
  await page.getByLabel('Seu @ no Instagram').fill(ex.instagram);
  await responderEtapa(page, 1, ex.respostas);
}

export async function responderEtapa(page, n, respostas) {
  for (const p of formulario.etapas[n - 1].perguntas) {
    const r = respostas[p.id];
    if (r === undefined) continue;
    const bloco = page.locator(`[data-pergunta="${p.id}"]`);
    if (p.tipo === 'texto_curto' || p.tipo === 'paragrafo') {
      await bloco.getByRole('textbox').fill(r);
    } else if (p.tipo === 'escala') {
      await bloco.getByRole('radio', { name: String(r), exact: true }).check();
    } else if (p.tipo === 'multipla_escolha') {
      if ('opcao' in r) {
        await bloco.getByRole('radio', { name: r.opcao, exact: true }).check();
      } else {
        await bloco.getByRole('radio', { name: 'Outro', exact: true }).check();
        await bloco.getByRole('textbox', { name: 'Qual? (Outro)' }).fill(r.outro);
      }
    } else {
      for (const opcao of r.opcoes) await bloco.getByRole('checkbox', { name: opcao, exact: true }).check();
      if (r.outro) {
        await bloco.getByRole('checkbox', { name: 'Outro', exact: true }).check();
        await bloco.getByRole('textbox', { name: 'Qual? (Outro)' }).fill(r.outro);
      }
    }
  }
}

export async function preencherEndereco(page, e) {
  await page.getByLabel('CEP').fill(e.cep);
  await expect(page.getByLabel('Rua')).toHaveValue('Avenida Paulista');
  await page.getByLabel('Rua').fill(e.logradouro);
  await page.getByLabel('Número').fill(e.numero);
  await page.getByLabel('Complemento (opcional)').fill(e.complemento);
  await page.getByLabel('Bairro').fill(e.bairro);
  await page.getByLabel('Cidade').fill(e.cidade);
  await page.getByLabel('Estado').selectOption(e.uf);
}

export async function avancar(page) {
  await page.getByRole('button', { name: 'Próximo' }).click();
}

export async function preencherTudo(page, ex) {
  await preencherEtapa1(page, ex);
  await avancar(page);
  await responderEtapa(page, 2, ex.respostas);
  await avancar(page);
  await responderEtapa(page, 3, ex.respostas);
  await avancar(page);
  await preencherEndereco(page, ex.endereco);
  await page.getByLabel(/Autorizo o Instituto METRIK/).check();
}
