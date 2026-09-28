// tests/nucleo.spec.js
import { expect, test } from '@playwright/test';
import { exemplo, formulario, prepararRotas, URL_TESTE } from './ajudantes.js';

test.beforeEach(async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
});

test('máscaras de WhatsApp e CEP', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    return [
      N.mascaraWhatsapp('11912345678'),
      N.mascaraWhatsapp('1134567890'),
      N.mascaraWhatsapp('(11) 91234-5678'),
      N.mascaraWhatsapp('+351 912 345 678'),
      N.mascaraWhatsapp('119'),
      N.mascaraCep('01310100'),
      N.mascaraCep('0131'),
    ];
  });
  expect(r).toEqual(['(11) 91234-5678', '(11) 3456-7890', '(11) 91234-5678', '+351912345678', '(11) 9', '01310-100', '0131']);
});

test('corretor de e-mail', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    return [N.sugerirEmail('ana@gmial.com'), N.sugerirEmail('ana@hotmial.com'), N.sugerirEmail('ana@gmail.com'), N.sugerirEmail('ana@escritorio.com.br'), N.sugerirEmail('ana')];
  });
  expect(r).toEqual(['ana@gmail.com', 'ana@hotmail.com', null, null, null]);
});

test('servidor fixo fora do localhost; ?api só aceita localhost', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    return [
      N.apiBase({ hostname: 'workshop.rodrigorosar.com.br', search: '?api=https://malicioso.example' }),
      N.apiBase({ hostname: 'localhost', search: '?api=http://localhost:4173' }),
      N.apiBase({ hostname: 'localhost', search: '?api=https://malicioso.example' }),
      N.apiBase({ hostname: 'localhost', search: '' }),
    ];
  });
  expect(r).toEqual(['https://dashboard.rodrigorosar.com.br', 'http://localhost:4173', 'http://localhost:3000', 'http://localhost:3000']);
});

test('canal e preenchimento pelo #', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    return [
      N.lerCanal('?utm_source=grupo&outra=1&utm_medium=' + 'a'.repeat(150)),
      N.lerPrefill('#email=ana%40exemplo.com.br&nome=Ana%20Souza'),
    ];
  });
  expect(r).toEqual([{ utm_source: 'grupo', utm_medium: 'a'.repeat(100) }, { email: 'ana@exemplo.com.br', nome: 'Ana Souza' }]);
});

test('definir devolve cópia e não altera o original', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    const a = { x: { y: 1 }, z: 2 };
    const b = N.definir(a, 'x.y', 9);
    return { a, b, mesmoObjeto: a === b, mesmoFilho: a.x === b.x };
  });
  expect(r).toEqual({ a: { x: { y: 1 }, z: 2 }, b: { x: { y: 9 }, z: 2 }, mesmoObjeto: false, mesmoFilho: false });
});

test('erros da etapa 1 vazia, na ordem da tela', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    return N.errosDaEtapa(1, N.estadoInicial(f), f);
  }, formulario);
  expect(Object.keys(r)).toEqual(['email', 'nome', 'whatsapp', 'instagram', 'respostas.acesso_evento', 'respostas.genero']);
  expect(r.email).toBe('Confira o e-mail: parece que falta algo.');
  expect(r['respostas.genero']).toBe('Escolha uma opção.');
});

test('etapa de cada campo', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    return ['email', 'respostas.idade', 'respostas.comprometimento', 'endereco.cep', 'consentimento'].map((c) => N.etapaDoCampo(c, f));
  }, formulario);
  expect(r).toEqual([1, 2, 3, 4, 4]);
});

test('montarEnvio produz exatamente o contrato (exemplo oficial)', async ({ page }) => {
  const envio = await page.evaluate(
    ({ f, ex }) => {
      const N = window.CredNucleo;
      const OUTRO = N.OUTRO;
      let d = N.estadoInicial(f);
      d = N.definir(d, 'email', ex.email);
      d = N.definir(d, 'nome', ex.nome);
      d = N.definir(d, 'whatsapp', ex.whatsapp);
      d = N.definir(d, 'instagram', ex.instagram);
      Object.keys(ex.endereco).forEach((k) => {
        d = N.definir(d, 'endereco.' + k, ex.endereco[k]);
      });
      d = N.definir(d, 'consentimento', true);
      f.etapas.forEach((e) =>
        e.perguntas.forEach((p) => {
          const r = ex.respostas[p.id];
          if (r === undefined) return;
          let ui = r;
          if (p.tipo === 'multipla_escolha') ui = 'opcao' in r ? { valor: r.opcao, outro: '' } : { valor: OUTRO, outro: r.outro };
          if (p.tipo === 'caixas_selecao') ui = { marcadas: r.opcoes, outroMarcado: r.outro !== null, outro: r.outro || '' };
          d = N.definir(d, 'respostas.' + p.id, ui);
        }),
      );
      return N.montarEnvio(f, d, { utm_source: 'grupo' }, 0, 312000, '');
    },
    { f: formulario, ex: exemplo },
  );
  expect(envio).toEqual(exemplo);
});

test('rascunho com formato estranho é ignorado campo a campo', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const base = N.estadoInicial(f);
    const salvo = { email: 'a@b.com', nome: 123, respostas: { idade: 'texto no lugar de objeto', comprometimento: 9 }, endereco: { cep: '01310-100', moraExterior: 'sim' } };
    const m = N.mesclarDados(base, salvo);
    return { email: m.email, nome: m.nome, idade: m.respostas.idade, comp: m.respostas.comprometimento, cep: m.endereco.cep, fora: m.endereco.moraExterior };
  }, formulario);
  expect(r).toEqual({ email: 'a@b.com', nome: '', idade: { valor: '', outro: '' }, comp: null, cep: '01310-100', fora: false });
});
