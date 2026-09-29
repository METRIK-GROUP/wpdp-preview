// tests/carga.spec.js
// Carga resiliente do formulário (fix "página espera o servidor acordar"):
// prazo de 45 s por tentativa, retentativa automática em falha passageira e
// a mensagem de espera depois de ~8 s. Testes de falha de script/formato do
// cardápio que já existiam em tela.spec.js moraram aqui desde o início desse
// fix — extraídos para este arquivo à parte para manter tela.spec.js dentro
// do limite de 800 linhas (o mesmo raciocínio de credenciamento/carga.js,
// separado de tela.js).
import { expect, test } from '@playwright/test';
import { avancarRelogio, formulario, prepararRotas, URL_TESTE } from './ajudantes.js';

test.describe('carga do formulário', () => {
  test('formulário encerrado', async ({ page }) => {
    await prepararRotas(page, { formularioResposta: { ...formulario, aberto: false } });
    await page.goto(URL_TESTE);
    await expect(page.getByRole('heading', { name: 'O credenciamento da 8ª edição foi encerrado.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'rodrigorosar.com.br/suporte' })).toBeVisible();
    await expect(page.locator('#titulo-encerrado')).toBeFocused(); // M-3
  });

  // M-5: se nucleo.js, envio.js ou tela.js não carregar (rede, 404) ou quebrar
  // ao iniciar, a página não pode ficar presa em "Carregando o formulário…".
  const FALHA_CARGA = 'Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.';
  async function conferirTelaDeFalha(page) {
    await expect(page.getByText(FALHA_CARGA)).toBeVisible();
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false');
    const suporte = page.getByRole('link', { name: 'Falar com o suporte', exact: true });
    await expect(suporte).toHaveAttribute('href', 'https://www.rodrigorosar.com.br/suporte');
    expect((await suporte.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }

  for (const arquivo of ['nucleo.js', 'protecao.js', 'envio.js', 'carga.js', 'tela.js']) {
    test(`${arquivo} não carrega: mensagem de falha, suporte e "Tentar de novo" que funciona`, async ({ page }) => {
      await prepararRotas(page);
      await page.route(`**/credenciamento/${arquivo}`, (r) => r.fulfill({ status: 404, body: 'não encontrado' }));
      await page.goto(URL_TESTE);
      await conferirTelaDeFalha(page);
      await page.unroute(`**/credenciamento/${arquivo}`);
      await page.getByRole('button', { name: 'Tentar de novo' }).click();
      await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    });
  }

  // I-1 + M-5: mesmo sem o tela.js, o "#email=...&nome=..." já saiu do
  // endereço (script em linha antes do GTM) e a vigia da carga descarta a
  // cópia em memória que só o tela.js consumiria.
  test('tela.js não carrega: e-mail/nome do # não ficam no endereço nem na memória', async ({ page }) => {
    await prepararRotas(page);
    await page.route('**/credenciamento/tela.js', (r) => r.fulfill({ status: 404, body: 'não encontrado' }));
    await page.goto(URL_TESTE + '#email=ana.souza%40exemplo.com.br&nome=Ana%20Souza');
    await conferirTelaDeFalha(page);
    expect(new URL(page.url()).hash).toBe('');
    expect(await page.evaluate(() => '__credPrefill' in window)).toBe(false);
  });

  // C4: cardápio sem edição ou sem versão (texto não vazio) é resposta
  // inválida — com a edição faltando, undefined === undefined faria todo
  // rascunho sem edição parecer "da mesma edição" e reabriria a mescla.
  for (const [nome, resposta] of [
    ['sem edição', { ...formulario, edicao: undefined }],
    ['com versão vazia', { ...formulario, versao: '' }],
  ]) {
    test(`formulário ${nome} cai na falha da carga`, async ({ page }) => {
      await prepararRotas(page, { formularioResposta: resposta });
      await page.goto(URL_TESTE);
      await expect(page.getByText(FALHA_CARGA)).toBeVisible();
      await expect(page.getByText(/Etapa \d de 4/)).toHaveCount(0);
    });
  }

  test('tela.js quebra ao iniciar: mensagem de falha em vez de "Carregando…" para sempre', async ({ page }) => {
    await prepararRotas(page);
    await page.route('**/credenciamento/tela.js', (r) =>
      r.fulfill({ contentType: 'text/javascript', body: 'throw new Error("falha ao iniciar");' }),
    );
    await page.goto(URL_TESTE);
    await conferirTelaDeFalha(page);
  });

  // Fix "página espera o servidor acordar": depois de um deploy do
  // dashboard (ou período ocioso), a primeira resposta pode demorar — a
  // carga tenta de novo sozinha (uma vez) antes de admitir derrota.
  test('servidor fora nas duas tentativas da carga: mensagem e "Tentar de novo" que funciona', async ({ page }) => {
    let tentativas = 0;
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', (r) => {
      tentativas += 1;
      return tentativas <= 2 ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: formulario });
    });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toBeVisible();
    expect(tentativas).toBe(2); // 1ª tentativa + 1 retentativa automática, sem ação da pessoa
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
  });

  test('servidor com uma falha passageira (5xx) na carga se recupera sozinho, sem mostrar erro', async ({ page }) => {
    let tentativas = 0;
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', (r) => {
      tentativas += 1;
      return tentativas === 1 ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: formulario });
    });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toHaveCount(0);
    expect(tentativas).toBe(2);
  });

  test('falha de rede na carga tenta de novo automaticamente e recupera sozinha', async ({ page }) => {
    let tentativas = 0;
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', (r) => {
      tentativas += 1;
      return tentativas === 1 ? r.abort('failed') : r.fulfill({ json: formulario });
    });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    expect(tentativas).toBe(2);
  });

  // Corpo que chega com status 200 mas não dá para interpretar como JSON
  // (ex.: queda de rede bem no meio da leitura) é diferente de um JSON válido
  // só que fora do formato: buscar() devolve dados:null nesse caso (tela.js),
  // e carga.js só desiste de tentar de novo quando o JSON foi mesmo lido.
  test('corpo 200 que não dá para interpretar como JSON tenta de novo', async ({ page }) => {
    let tentativas = 0;
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', (r) => {
      tentativas += 1;
      if (tentativas === 1) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"edicao":' }); // corpo cortado no meio
      return r.fulfill({ json: formulario });
    });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    expect(tentativas).toBe(2);
  });

  // 4xx é resposta REAL do servidor sobre o pedido (não um problema
  // passageiro dele) — nunca tenta de novo sozinha.
  test('4xx na carga não tenta de novo', async ({ page }) => {
    let tentativas = 0;
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', (r) => {
      tentativas += 1;
      return r.fulfill({ status: 404, json: {} });
    });
    await page.goto(URL_TESTE);
    await expect(page.getByText('Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.')).toBeVisible();
    expect(tentativas).toBe(1);
  });
});

// Fix "página espera o servidor acordar": prazo de 45 s por tentativa da
// carga (bem maior que o antigo, de 15 s — visto em produção: 38,9 s e
// 19,4 s na 1ª resposta depois de um deploy do dashboard), retentativa
// automática depois de uma pausa de ~1,5 s (dá tempo de um blip passageiro se
// resolver sozinho) e a mensagem de espera depois de ~8 s (as duas tentativas
// somadas com a pausa entre elas). Usa o relógio falso do Playwright
// (page.clock) para verificar esses prazos sem esperar de verdade — a
// resposta do servidor simulado fica pendurada numa promise controlada pelo
// teste (o Node por trás da rota não usa o relógio falso da página) até o
// teste liberar.
test.describe('carga resiliente do formulário (relógio falso)', () => {
  const FALHA_CARGA = 'Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.';
  const MENSAGEM_ESPERA = 'Carregando o formulário… pode levar alguns segundos.';
  const regiaoDeEspera = (page) => page.locator('#carregando-espera');

  function segurarResposta() {
    let liberar;
    const pronta = new Promise((resolver) => {
      liberar = resolver;
    });
    return { pronta, liberar: () => liberar() };
  }

  test('primeira resposta demorada (30 s, dentro do prazo de 45 s): formulário aparece sem erro', async ({ page }) => {
    let tentativas = 0;
    const { pronta, liberar } = segurarResposta();
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', async (r) => {
      tentativas += 1;
      await pronta;
      return r.fulfill({ json: formulario });
    });
    await page.clock.install();
    await page.goto(URL_TESTE);
    await page.clock.fastForward(30_000);
    liberar();
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    await expect(page.getByText(FALHA_CARGA)).toHaveCount(0);
    expect(tentativas).toBe(1); // não precisou de retentativa
  });

  // Fixa a fronteira dos 45 s: 44 s ainda não é o bastante (nenhuma
  // retentativa), só depois dos 45 s (+ a pausa de 1,5 s antes da retentativa).
  test('44 s ainda não estoura o prazo da 1ª tentativa; só depois de 45 s (+ pausa) dispara a retentativa', async ({ page }) => {
    let tentativas = 0;
    let soltarPrimeira = () => {};
    const presaPrimeira = new Promise((resolver) => {
      soltarPrimeira = resolver;
    });
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', async (r) => {
      tentativas += 1;
      if (tentativas === 1) {
        await presaPrimeira; // só a 1ª tentativa trava; quem desiste dela é o prazo do CLIENTE (45 s)
        return r.abort().catch(() => {});
      }
      return r.fulfill({ json: formulario });
    });
    try {
      await page.clock.install();
      await page.goto(URL_TESTE);
      await page.clock.fastForward(44_000); // ainda dentro do prazo: nenhuma retentativa disparou
      expect(tentativas).toBe(1);
      await page.clock.fastForward(4_000); // passa dos 45 s + a pausa de 1,5 s antes da retentativa
      await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
      await expect(page.getByText(FALHA_CARGA)).toHaveCount(0);
      expect(tentativas).toBe(2);
    } finally {
      soltarPrimeira();
    }
  });

  test('as duas tentativas travam além de 45 s: tela de falha da carga (a existente)', async ({ page }) => {
    let soltar = () => {};
    const presa = new Promise((resolver) => {
      soltar = resolver;
    });
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', async (r) => {
      await presa; // nenhuma das duas tentativas responde: quem desiste é sempre o prazo do CLIENTE
      return r.abort().catch(() => {});
    });
    try {
      await page.clock.install();
      await page.goto(URL_TESTE);
      // Passos pequenos (não um salto só): a cadeia prazo → pausa → prazo de
      // novo encadeia com mais confiança assim (ver avancarRelogio).
      await avancarRelogio(page, 96_000); // estoura a 1ª tentativa (45 s) + pausa (1,5 s) + a retentativa (45 s)
      await expect(page.getByText(FALHA_CARGA)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
    } finally {
      soltar();
    }
  });

  // A região da mensagem (#carregando-espera) nasce vazia e já no DOM desde
  // o início da carga — só o texto chega aos ~8 s (mutação, não um nó novo
  // que já chega pronto: só assim o leitor de tela anuncia de forma
  // confiável). Some (nó removido, não só escondido) ao terminar.
  test('região da mensagem de espera nasce vazia, ganha o texto aos ~8 s e some quando o formulário chega', async ({ page }) => {
    const { pronta, liberar } = segurarResposta();
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', async (r) => {
      await pronta;
      return r.fulfill({ json: formulario });
    });
    await page.clock.install();
    await page.goto(URL_TESTE);
    const regiao = regiaoDeEspera(page);
    await expect(regiao).toHaveCount(1); // já nasce no DOM, não só quando o texto chega
    await expect(regiao).toHaveAttribute('aria-live', 'polite');
    await expect(regiao).toBeEmpty();
    await page.clock.fastForward(8_001);
    await expect(regiao).toHaveText(MENSAGEM_ESPERA);
    liberar();
    await expect(page.getByText('Etapa 1 de 4')).toBeVisible();
    await expect(regiaoDeEspera(page)).toHaveCount(0);
  });

  test('mensagem de espera some quando as duas tentativas falham (tela de erro)', async ({ page }) => {
    let soltar = () => {};
    const presa = new Promise((resolver) => {
      soltar = resolver;
    });
    await prepararRotas(page);
    await page.route('**/api/public/credenciamento/formulario*', async (r) => {
      await presa;
      return r.abort().catch(() => {});
    });
    try {
      await page.clock.install();
      await page.goto(URL_TESTE);
      await page.clock.fastForward(8_001);
      await expect(regiaoDeEspera(page)).toHaveText(MENSAGEM_ESPERA);
      await avancarRelogio(page, 96_000); // estoura a 1ª tentativa + pausa + a retentativa (ver avancarRelogio)
      await expect(page.getByText(FALHA_CARGA)).toBeVisible();
      await expect(regiaoDeEspera(page)).toHaveCount(0);
    } finally {
      soltar();
    }
  });
});
