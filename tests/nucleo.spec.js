// tests/nucleo.spec.js
import { expect, test } from '@playwright/test';
import { exemplo, formulario, prepararRotas, URL_TESTE } from './ajudantes.js';

test.beforeEach(async ({ page }) => {
  await prepararRotas(page);
  await page.goto(URL_TESTE);
});

test('máscara do WhatsApp', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    return [
      N.mascaraWhatsapp('11912345678'),
      N.mascaraWhatsapp('1134567890'),
      N.mascaraWhatsapp('(11) 91234-5678'),
      N.mascaraWhatsapp('+351 912 345 678'),
      N.mascaraWhatsapp('119'),
    ];
  });
  expect(r).toEqual(['(11) 91234-5678', '(11) 3456-7890', '(11) 91234-5678', '+351912345678', '(11) 9']);
});

// Decisão do dono (29/09/2026): sem endereço e sem Instagram — o núcleo não
// guarda mais regra, máscara nem mensagem de nenhum dos dois.
test('o núcleo não tem mais nada de endereço, CEP nem Instagram', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    return {
      funcoes: ['mascaraCep', 'UFS', 'normalizarInstagram'].filter((k) => k in N),
      mensagens: ['instagram', 'cep', 'uf', 'cepNaoEncontrado'].filter((k) => k in N.MENSAGENS),
    };
  });
  expect(r).toEqual({ funcoes: [], mensagens: [] });
});

// I-3 (Armadilha 2 do phone.ts do dashboard): sem "+", a máscara não pode
// cortar em 11 dígitos — "55 19 99999-9999" virava "(55) 19999-9999", um
// número incompleto. Zero de discagem na frente cai; mais de 11 dígitos
// viram formato internacional ("+" + até 15 dígitos).
test('máscara do WhatsApp: DDI sem "+" não é cortado e zero de discagem cai', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    return [
      N.mascaraWhatsapp('5519999999999'),
      N.mascaraWhatsapp('55 19 99999-9999'),
      N.mascaraWhatsapp('019 99999-9999'),
      N.mascaraWhatsapp('0055 19 99999-9999'),
      N.mascaraWhatsapp('000'),
      N.mascaraWhatsapp('+55 19 99999-9999'),
      N.mascaraWhatsapp('5519999999999999999'),
    ];
  });
  expect(r).toEqual(['+5519999999999', '+5519999999999', '(19) 99999-9999', '+5519999999999', '', '+5519999999999', '+551999999999999']);
});

// C2: mesma gramática do servidor — e-mail válido do WHATWG + pelo menos um
// ponto no domínio, depois de aparar e passar para minúsculas; até 254.
test('e-mail validado como no servidor (WHATWG + ponto no domínio)', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const base = N.estadoInicial(f);
    const veredito = (v) => (N.errosDaEtapa(1, N.definir(base, 'email', v), f).email ? 'recusado' : 'aceito');
    const rotulo63 = 'a'.repeat(63);
    const casos = {
      'ana@gmail': 'recusado',
      'x<v@gmail.com>': 'recusado',
      'v@gmail.com,': 'recusado',
      'ana souza@gmail.com': 'recusado',
      'ana@-exemplo.com': 'recusado',
      'ana@exemplo-.com': 'recusado',
      'ana@exemplo..com': 'recusado',
      'ana@.exemplo.com': 'recusado',
      'ana@exemplo.com.': 'recusado',
      '@exemplo.com': 'recusado',
      'ana@@exemplo.com': 'recusado',
      ['ana@' + rotulo63 + 'a.com']: 'recusado', // rótulo com 64
      ['a'.repeat(245) + '@exemplo.com']: 'recusado', // 257 no total
      'ana.souza@exemplo.com.br': 'aceito',
      'a+b@x.io': 'aceito',
      '  Ana.Souza@Exemplo.COM.br  ': 'aceito',
      "o'brien@exemplo.com": 'aceito',
      'a`b{c}|d~e@x.io': 'aceito',
      'a!#$%&*/=?^_-b@sub-dominio.exemplo.com': 'aceito',
      ['ana@' + rotulo63 + '.com']: 'aceito', // rótulo com 63
      ['a'.repeat(242) + '@exemplo.com']: 'aceito', // 254 no total
    };
    const curto = (v) => (v.length > 40 ? v.slice(0, 12) + '... (' + v.length + ' caracteres)' : v);
    return Object.keys(casos)
      .filter((v) => veredito(v) !== casos[v])
      .map((v) => curto(v) + ' deveria ser ' + casos[v]);
  }, formulario);
  expect(r).toEqual([]); // lista vazia = todos os casos como no servidor
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
  expect(Object.keys(r)).toEqual(['email', 'nome', 'whatsapp', 'respostas.acesso_evento', 'respostas.genero']);
  expect(r.email).toBe('Confira o e-mail: parece que falta algo.');
  expect(r['respostas.genero']).toBe('Escolha uma opção.');
});

test('etapa de cada campo (a autorização fica na última etapa visível)', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const campos = ['email', 'nome', 'whatsapp', 'respostas.acesso_evento', 'respostas.idade', 'respostas.comprometimento', 'consentimento'];
    const semAEtapa2 = { ...f, etapas: f.etapas.map((e, i) => (i === 1 ? { ...e, perguntas: [] } : e)) };
    return { normal: campos.map((c) => N.etapaDoCampo(c, f)), semAEtapa2: campos.map((c) => N.etapaDoCampo(c, semAEtapa2)) };
  }, formulario);
  expect(r.normal).toEqual([1, 1, 1, 1, 2, 3, 3]);
  expect(r.semAEtapa2).toEqual([1, 1, 1, 1, 1, 2, 2]); // "idade" sumiu do cardápio: cai no padrão (etapa 1)
});

// O servidor segue mandando as 4 etapas ([2, 12, 12, 0] perguntas) durante a
// transição: a 4ª (sem perguntas) era a do endereço. Só as que têm perguntas
// aparecem, em qualquer posição.
test('etapas visíveis: só as que têm perguntas', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const titulos = (form) => N.etapasVisiveis(form).map((e) => e.titulo);
    const semAEtapa2 = { ...f, etapas: f.etapas.map((e, i) => (i === 1 ? { ...e, perguntas: [] } : e)) };
    const soTres = { ...f, etapas: f.etapas.slice(0, 3) };
    return {
      contrato: [titulos(f), N.totalEtapas(f)],
      semAEtapa2: [titulos(semAEtapa2), N.totalEtapas(semAEtapa2)],
      soTres: [titulos(soTres), N.totalEtapas(soTres)],
    };
  }, formulario);
  expect(r).toEqual({
    contrato: [['Seus dados', 'Perfil profissional', 'Seu momento'], 3],
    semAEtapa2: [['Seus dados', 'Seu momento'], 2],
    soTres: [['Seus dados', 'Perfil profissional', 'Seu momento'], 3],
  });
});

// Rascunho da página anterior pode estar na etapa 4 (a do endereço, que
// saiu); gravação parcial ou formato antigo podem trazer lixo. A etapa salva
// sempre vira uma etapa que existe: inteira, entre 1 e a última visível.
test('etapa salva no rascunho é limitada às etapas visíveis', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    return [4, 3, 2.5, '2', 0, -3, 99, 'abc', null, undefined, NaN, Infinity].map((v) => N.limitarEtapa(v, f));
  }, formulario);
  expect(r).toEqual([3, 3, 2, 2, 1, 1, 3, 1, 1, 1, 1, 3]);
});

// C4 + etapas visíveis: o cardápio precisa de edição e versão (texto não
// vazio) e de pelo menos uma etapa com perguntas; cada etapa com a sua lista
// de perguntas. Continua aceitando as 4 etapas de hoje — e também 3, se o
// servidor um dia deixar de mandar a do endereço.
test('formato mínimo do cardápio', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const casos = {
      contrato: f,
      soTres: { ...f, etapas: f.etapas.slice(0, 3) },
      semEdicao: { ...f, edicao: undefined },
      versaoVazia: { ...f, versao: '' },
      semEtapas: { ...f, etapas: [] },
      nenhumaComPerguntas: { ...f, etapas: f.etapas.map((e) => ({ ...e, perguntas: [] })) },
      etapaSemLista: { ...f, etapas: [...f.etapas.slice(0, 3), { numero: 4, titulo: 'x', ajuda: null }] },
      etapaNula: { ...f, etapas: [...f.etapas.slice(0, 3), null] },
      nulo: null,
    };
    return Object.fromEntries(Object.entries(casos).map(([nome, form]) => [nome, N.formularioValido(form)]));
  }, formulario);
  expect(r).toEqual({
    contrato: true,
    soTres: true,
    semEdicao: false,
    versaoVazia: false,
    semEtapas: false,
    nenhumaComPerguntas: false,
    etapaSemLista: false,
    etapaNula: false,
    nulo: false,
  });
});

test('autorização só é pedida na última etapa visível', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const vazio = N.estadoInicial(f);
    return [1, 2, 3, 4].map((n) => 'consentimento' in N.errosDaEtapa(n, vazio, f));
  }, formulario);
  expect(r).toEqual([false, false, true, false]);
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
    const salvo = { email: 'a@b.com', nome: 123, respostas: { idade: 'texto no lugar de objeto', comprometimento: 9 }, consentimento: 'sim' };
    const m = N.mesclarDados(base, salvo);
    return { email: m.email, nome: m.nome, idade: m.respostas.idade, comp: m.respostas.comprometimento, consentimento: m.consentimento };
  }, formulario);
  expect(r).toEqual({ email: 'a@b.com', nome: '', idade: { valor: '', outro: '' }, comp: null, consentimento: false });
});

// Rascunho gravado pela página anterior: Instagram e endereço são ignorados
// (não voltam, não vão no envio, não são regravados); o resto continua.
test('rascunho da página anterior: Instagram e endereço ficam de fora', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const salvo = {
      email: 'ana@exemplo.com.br',
      nome: 'Ana Souza',
      whatsapp: '(11) 91234-5678',
      instagram: '@anasouza.arq',
      semInstagram: false,
      endereco: { moraExterior: false, cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: '', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP', pais: '', enderecoCompleto: '' },
      respostas: { idade: { valor: '26 a 35 anos', outro: '' } },
      consentimento: true,
    };
    const m = N.mesclarDados(N.estadoInicial(f), salvo);
    const migrado = N.migrarDados(f, salvo);
    return {
      chaves: Object.keys(m),
      chavesMigrado: Object.keys(migrado),
      estadoInicial: Object.keys(N.estadoInicial(f)),
      idade: m.respostas.idade,
      consentimento: m.consentimento,
      envio: Object.keys(N.montarEnvio(f, m, {}, 0, 1000, '')),
    };
  }, formulario);
  expect(r).toEqual({
    chaves: ['email', 'nome', 'whatsapp', 'respostas', 'consentimento'],
    chavesMigrado: ['email', 'nome', 'whatsapp', 'respostas', 'consentimento'],
    estadoInicial: ['email', 'nome', 'whatsapp', 'respostas', 'consentimento'],
    idade: { valor: '26 a 35 anos', outro: '' },
    consentimento: true,
    envio: ['edicao', 'versao', 'email', 'nome', 'whatsapp', 'respostas', 'consentimento', 'canal', 'tempoPreenchimentoS', 'empresa_site'],
  });
});

test('rascunho com opção de múltipla escolha removida do cardápio é descartada ao restaurar', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const base = N.estadoInicial(f);
    const salvo = {
      respostas: {
        acesso_evento: { valor: 'Opção que não existe mais no cardápio', outro: '' },
        genero: { valor: 'Feminino', outro: '' },
        formacao: { valor: N.OUTRO, outro: 'Design gráfico' },
      },
    };
    const m = N.mesclarDados(base, salvo);
    return {
      outro: N.OUTRO,
      removida: m.respostas.acesso_evento,
      mantidaOpcao: m.respostas.genero,
      mantidaOutro: m.respostas.formacao,
    };
  }, formulario);
  expect(r.removida).toEqual({ valor: '', outro: '' });
  expect(r.mantidaOpcao).toEqual({ valor: 'Feminino', outro: '' });
  expect(r.mantidaOutro).toEqual({ valor: r.outro, outro: 'Design gráfico' });
});

// M-6: cardápio novo em que a pergunta deixou de aceitar "Outro" (ou perdeu
// uma opção de caixa): o rascunho mesclado não pode trazer isso de volta.
test('mesclarDados descarta "Outro" onde a pergunta não aceita mais e opções de caixa que sumiram', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const v2 = JSON.parse(JSON.stringify(f));
    v2.etapas.forEach((e) => e.perguntas.forEach((p) => {
      if (p.id === 'genero' || p.id === 'servicos') p.permiteOutro = false;
    }));
    const salvo = {
      respostas: {
        genero: { valor: N.OUTRO, outro: 'Prefiro não dizer' },
        formacao: { valor: N.OUTRO, outro: 'Design gráfico' },
        servicos: { marcadas: ['Projetos de interiores', 'Opção que não existe mais'], outroMarcado: true, outro: 'Consultoria de cor' },
        pos_graduacao: { marcadas: [], outroMarcado: true, outro: 'Iluminação' },
      },
    };
    const m = N.mesclarDados(N.estadoInicial(v2), salvo);
    return { outro: N.OUTRO, genero: m.respostas.genero, formacao: m.respostas.formacao, servicos: m.respostas.servicos, pos: m.respostas.pos_graduacao };
  }, formulario);
  expect(r.genero).toEqual({ valor: '', outro: '' });
  expect(r.formacao).toEqual({ valor: r.outro, outro: 'Design gráfico' }); // ainda aceita "Outro": fica
  expect(r.servicos).toEqual({ marcadas: ['Projetos de interiores'], outroMarcado: false, outro: '' });
  expect(r.pos).toEqual({ marcadas: [], outroMarcado: true, outro: 'Iluminação' }); // ainda aceita "Outro": fica
});

test('montarEnvio nunca manda "outro" em pergunta que não aceita "Outro"', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const v2 = JSON.parse(JSON.stringify(f));
    v2.etapas.forEach((e) => e.perguntas.forEach((p) => {
      if (p.id === 'genero' || p.id === 'servicos') p.permiteOutro = false;
    }));
    let d = N.estadoInicial(v2);
    d = N.definir(d, 'respostas.genero', { valor: N.OUTRO, outro: 'Prefiro não dizer' });
    d = N.definir(d, 'respostas.formacao', { valor: N.OUTRO, outro: 'Design gráfico' });
    d = N.definir(d, 'respostas.servicos', { marcadas: ['Projetos de interiores'], outroMarcado: true, outro: 'Consultoria de cor' });
    const respostas = N.montarEnvio(v2, d, {}, 0, 60000, '').respostas;
    return { temGenero: 'genero' in respostas, formacao: respostas.formacao, servicos: respostas.servicos };
  }, formulario);
  expect(r).toEqual({
    temGenero: false,
    formacao: { outro: 'Design gráfico' },
    servicos: { opcoes: ['Projetos de interiores'], outro: null },
  });
});

test('validarPergunta não aceita "Outro" em pergunta que não aceita "Outro"', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const todas = f.etapas.reduce((t, e) => t.concat(e.perguntas), []);
    const genero = { ...todas.find((q) => q.id === 'genero'), permiteOutro: false };
    const servicos = { ...todas.find((q) => q.id === 'servicos'), permiteOutro: false };
    return [
      N.validarPergunta(genero, { valor: N.OUTRO, outro: 'Prefiro não dizer' }),
      N.validarPergunta(servicos, { marcadas: [], outroMarcado: true, outro: 'Consultoria de cor' }),
      N.validarPergunta(servicos, { marcadas: ['Projetos de interiores'], outroMarcado: true, outro: '' }),
      // opção de caixa que não existe mais no cardápio não conta como resposta
      N.validarPergunta(servicos, { marcadas: ['Opção que não existe mais'], outroMarcado: false, outro: '' }),
    ];
  }, formulario);
  expect(r).toEqual(['Escolha uma opção.', 'Marque pelo menos uma opção.', null, 'Marque pelo menos uma opção.']);
});

// O-1 / N-2: rascunho de outra versão mescla o que ainda vale e zera a
// autorização; a primeira etapa com erro é a que o rascunho migrado abre.
test('migrarDados zera a autorização e primeiraEtapaComErro acha a primeira etapa com erro', async ({ page }) => {
  const r = await page.evaluate(
    ({ f, ex }) => {
      const N = window.CredNucleo;
      let d = N.estadoInicial(f);
      ['email', 'nome', 'whatsapp'].forEach((k) => {
        d = N.definir(d, k, ex[k]);
      });
      f.etapas.forEach((e) =>
        e.perguntas.forEach((p) => {
          const resp = ex.respostas[p.id];
          if (resp === undefined) return;
          let ui = resp;
          if (p.tipo === 'multipla_escolha') ui = 'opcao' in resp ? { valor: resp.opcao, outro: '' } : { valor: N.OUTRO, outro: resp.outro };
          if (p.tipo === 'caixas_selecao') ui = { marcadas: resp.opcoes, outroMarcado: resp.outro !== null, outro: resp.outro || '' };
          d = N.definir(d, 'respostas.' + p.id, ui);
        }),
      );
      const semAutorizacao = d; // as 3 etapas respondidas; só a autorização vazia
      const completo = N.definir(d, 'consentimento', true);
      const migrado = N.migrarDados(f, completo);
      return {
        email: migrado.email,
        consentimento: migrado.consentimento,
        original: completo.consentimento, // sem mutação
        etapas: [
          N.primeiraEtapaComErro(N.estadoInicial(f), f, 3),
          N.primeiraEtapaComErro(semAutorizacao, f, 2),
          N.primeiraEtapaComErro(completo, f, 3),
          N.primeiraEtapaComErro(completo, f, 4), // etapa atual além da última visível: fica na última
          N.primeiraEtapaComErro(migrado, f, 2),
        ],
      };
    },
    { f: formulario, ex: exemplo },
  );
  expect(r).toEqual({ email: 'ana.souza@exemplo.com.br', consentimento: false, original: true, etapas: [1, 3, 3, 3, 3] });
});

test('validarPergunta recusa valor de múltipla escolha fora do cardápio atual', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    const p = f.etapas[0].perguntas.find((q) => q.id === 'acesso_evento');
    return [
      N.validarPergunta(p, { valor: 'Opção que não existe mais no cardápio', outro: '' }),
      N.validarPergunta(p, { valor: p.opcoes[0], outro: '' }),
      N.validarPergunta(p, { valor: '', outro: '' }),
    ];
  }, formulario);
  expect(r).toEqual(['Escolha uma opção.', null, 'Escolha uma opção.']);
});

test('montarEnvio apara os contatos e nunca manda tempoPreenchimentoS inválido', async ({ page }) => {
  const r = await page.evaluate((f) => {
    const N = window.CredNucleo;
    let d = N.estadoInicial(f);
    d = N.definir(d, 'nome', '  Ana Souza ');
    const comEspaco = N.montarEnvio(f, d, {}, 0, 1000, '').nome;
    const numeroNormal = N.montarEnvio(f, d, {}, 0, 5000, '').tempoPreenchimentoS;
    const relogioForaDeOrdem = N.montarEnvio(f, d, {}, 5000, 0, '').tempoPreenchimentoS;
    const semInicio = N.montarEnvio(f, d, {}, undefined, 5000, '').tempoPreenchimentoS;
    const naoNumerico = N.montarEnvio(f, d, {}, 'abc', 5000, '').tempoPreenchimentoS;
    return { comEspaco, numeroNormal, relogioForaDeOrdem, semInicio, naoNumerico };
  }, formulario);
  expect(r).toEqual({ comEspaco: 'Ana Souza', numeroNormal: 5, relogioForaDeOrdem: 0, semInicio: 0, naoNumerico: 0 });
});

test('obter lê caminho aninhado e devolve undefined sem lançar quando falta', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;
    const obj = { respostas: { motivacao: 'Indicação', idade: null } };
    return [
      N.obter(obj, 'respostas.motivacao'),
      N.obter(obj, 'respostas.idade'),
      N.obter(obj, 'respostas.renda'),
      N.obter(obj, 'nada.aqui.dentro'),
    ];
  });
  expect(r).toEqual(['Indicação', null, undefined, undefined]);
});

test('armazenamento e rascunho funcionam normalmente e não lançam quando localStorage falha', async ({ page }) => {
  const r = await page.evaluate(() => {
    const N = window.CredNucleo;

    const s = N.armazenamento();
    const funcionaNormal = s !== null;
    N.salvarRascunho(s, { x: 1 });
    const lido = N.carregarRascunho(s);
    N.apagarRascunho(s);
    const apagado = N.carregarRascunho(s);

    const quebrado = {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    };
    let semLancarComArmazemQuebrado = true;
    let lidoQuebrado = 'não tentou';
    try {
      N.salvarRascunho(quebrado, { x: 1 });
      lidoQuebrado = N.carregarRascunho(quebrado);
      N.apagarRascunho(quebrado);
    } catch (e) {
      semLancarComArmazemQuebrado = false;
    }

    let semArmazem = 'não tentou';
    let semLancarNoAcesso = true;
    const descritorOriginal = Object.getOwnPropertyDescriptor(window, 'localStorage');
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new Error('bloqueado'); },
      });
      semArmazem = N.armazenamento();
    } catch (e) {
      semLancarNoAcesso = false;
    } finally {
      if (descritorOriginal) Object.defineProperty(window, 'localStorage', descritorOriginal);
    }

    return { funcionaNormal, lido, apagado, semLancarComArmazemQuebrado, lidoQuebrado, semArmazem, semLancarNoAcesso };
  });
  expect(r).toEqual({
    funcionaNormal: true,
    lido: { x: 1 },
    apagado: null,
    semLancarComArmazemQuebrado: true,
    lidoQuebrado: null,
    semArmazem: null,
    semLancarNoAcesso: true,
  });
});
