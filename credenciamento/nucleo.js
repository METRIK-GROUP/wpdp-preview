// credenciamento/nucleo.js
// Regras sem tela da página de credenciamento: servidor, canal, preenchimento
// pelo "#", rascunho, etapas visíveis, máscara, corretor de e-mail, validação
// e montagem do envio.
// Regras e mensagens espelham o servidor (dashboard: src/lib/credenciamento/validar.ts).
// Decisão do dono (29/09/2026): sem endereço e sem Instagram — o servidor
// ainda manda a 4ª etapa (sem perguntas; era a do endereço) e os textos
// antigos durante a transição, mas a página só mostra as etapas que têm
// perguntas e nunca pede nem manda Instagram ou endereço.
(function () {
  'use strict';

  var PRODUCAO = 'https://dashboard.rodrigorosar.com.br';
  var CHAVE_RASCUNHO = 'wpdp-credenciamento-ed8-rascunho';
  var OUTRO = '__outro__';
  var DOMINIOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br', 'yahoo.com', 'icloud.com', 'live.com', 'uol.com.br', 'bol.com.br', 'terra.com.br'];
  var CHAVES_CANAL = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  var CONTATOS = ['email', 'nome', 'whatsapp'];
  // C2: mesma gramática do servidor — "valid e-mail address" do WHATWG com
  // pelo menos um ponto no domínio (2+ rótulos), aplicada já em minúsculas.
  var EMAIL = /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  var LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  var MENSAGENS = {
    obrigatorio: 'Preencha este campo.',
    escolha: 'Escolha uma opção.',
    marque: 'Marque pelo menos uma opção.',
    outro: 'Escreva qual é a outra opção.',
    longo: 'Texto muito longo.',
    email: 'Confira o e-mail: parece que falta algo.',
    whatsapp: 'Informe o WhatsApp com DDD.',
    consentimento: 'Para concluir, marque a autorização.',
    falhaEnvio: 'Não conseguimos registrar agora. Suas respostas estão salvas neste aparelho; tente de novo em instantes.',
  };

  function texto(valor) {
    return typeof valor === 'string' ? valor : '';
  }

  function apiBase(local) {
    var ehLocal = local.hostname === 'localhost' || local.hostname === '127.0.0.1';
    if (!ehLocal) return PRODUCAO;
    var pedido = new URLSearchParams(local.search || '').get('api');
    return pedido && LOCAL.test(pedido) ? pedido : 'http://localhost:3000';
  }

  function lerCanal(busca) {
    var params = new URLSearchParams(busca || '');
    var canal = {};
    CHAVES_CANAL.forEach(function (chave) {
      var valor = (params.get(chave) || '').trim().slice(0, 100);
      if (valor) canal[chave] = valor;
    });
    return canal;
  }

  function lerPrefill(hash) {
    var params = new URLSearchParams(texto(hash).replace(/^#/, ''));
    return {
      email: (params.get('email') || '').trim().slice(0, 254),
      nome: (params.get('nome') || '').trim().slice(0, 120),
    };
  }

  function armazenamento() {
    try {
      var s = window.localStorage;
      s.setItem('__cred_teste__', '1');
      s.removeItem('__cred_teste__');
      return s;
    } catch (e) {
      return null; // navegador sem armazenamento: a página segue sem rascunho
    }
  }

  function carregarRascunho(armazem) {
    if (!armazem) return null;
    try {
      var bruto = armazem.getItem(CHAVE_RASCUNHO);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null; // rascunho corrompido é ignorado
    }
  }

  function salvarRascunho(armazem, rascunho) {
    if (!armazem) return;
    try {
      armazem.setItem(CHAVE_RASCUNHO, JSON.stringify(rascunho));
    } catch (e) {
      // armazenamento cheio ou bloqueado: segue sem rascunho
    }
  }

  function apagarRascunho(armazem) {
    if (!armazem) return;
    try {
      armazem.removeItem(CHAVE_RASCUNHO);
    } catch (e) {
      // idem
    }
  }

  function temPerguntas(etapa) {
    return etapa.perguntas.length > 0;
  }

  /**
   * Etapas que aparecem na tela: só as que têm perguntas, na ordem do
   * servidor. A tela numera por posição aqui (1, 2, 3…), não pelo "numero"
   * do servidor — hoje dá no mesmo, porque a etapa sem perguntas é a última.
   */
  function etapasVisiveis(formulario) {
    return formulario.etapas.filter(temPerguntas);
  }

  function totalEtapas(formulario) {
    return etapasVisiveis(formulario).length;
  }

  /**
   * Etapa salva (rascunho, 409) sempre vira uma etapa que existe: inteira,
   * entre 1 e a última visível. Rascunho da página anterior pode estar na
   * etapa 4 (a do endereço, que saiu) — volta na última; gravação parcial ou
   * formato antigo (ex.: 2.5, texto) nunca quebram a página (M-6).
   */
  function limitarEtapa(valor, formulario) {
    var n = Math.trunc(Number(valor)) || 1;
    return Math.min(Math.max(1, n), totalEtapas(formulario));
  }

  /**
   * Formato mínimo do cardápio vindo do servidor: edição/versão como texto
   * não vazio (C4) e etapas com a lista de perguntas, com pelo menos uma
   * etapa que tenha perguntas. Sem edição, `undefined === undefined` faria
   * todo rascunho sem edição parecer "da mesma edição" e reabriria a mescla.
   * Hoje o servidor manda 4 etapas (a 4ª sem perguntas); 3 também valem.
   */
  function formularioValido(f) {
    var textoCheio = function (v) { return typeof v === 'string' && v !== ''; };
    var etapaValida = function (e) { return !!e && Array.isArray(e.perguntas); };
    return (
      !!f && textoCheio(f.edicao) && textoCheio(f.versao) &&
      Array.isArray(f.etapas) && f.etapas.length > 0 && f.etapas.every(etapaValida) && f.etapas.some(temPerguntas)
    );
  }

  function perguntasDe(formulario) {
    return formulario.etapas.reduce(function (todas, etapa) {
      return todas.concat(etapa.perguntas);
    }, []);
  }

  function respostaVazia(p) {
    if (p.tipo === 'multipla_escolha') return { valor: '', outro: '' };
    if (p.tipo === 'caixas_selecao') return { marcadas: [], outroMarcado: false, outro: '' };
    if (p.tipo === 'escala') return null;
    return '';
  }

  function estadoInicial(formulario) {
    var respostas = {};
    var regrasPorPergunta = {};
    perguntasDe(formulario).forEach(function (p) {
      respostas[p.id] = respostaVazia(p);
      if (p.tipo === 'multipla_escolha' || p.tipo === 'caixas_selecao') {
        regrasPorPergunta[p.id] = { opcoes: p.opcoes, permiteOutro: !!p.permiteOutro };
      }
    });
    var estado = {
      email: '',
      nome: '',
      whatsapp: '',
      respostas: respostas,
      consentimento: false,
    };
    // Metadado interno para mesclarDados saber quais opções (e se "Outro")
    // valem HOJE em cada pergunta de escolha (o cardápio pode mudar sem
    // trocar a versão do rascunho, e o 409 mescla rascunho de outra versão).
    // Não enumerável de propósito: não aparece no JSON.stringify do rascunho
    // salvo, nem no Object.assign de definir(), nem em comparação por
    // igualdade — não faz parte do formato público do estado.
    Object.defineProperty(estado, '_regrasPorPergunta', { value: regrasPorPergunta, enumerable: false });
    return estado;
  }

  /** Cópia com o valor trocado no caminho "a.b" (nunca altera o original). */
  function definir(obj, chave, valor) {
    var partes = chave.split('.');
    var copia = Object.assign({}, obj);
    copia[partes[0]] = partes.length === 1 ? valor : definir(obj[partes[0]] || {}, partes.slice(1).join('.'), valor);
    return copia;
  }

  function obter(obj, chave) {
    return chave.split('.').reduce(function (atual, parte) {
      return atual === null || atual === undefined ? undefined : atual[parte];
    }, obj);
  }

  function mesmoFormato(base, salvo, regra) {
    if (typeof base === 'string') return typeof salvo === 'string';
    if (base === null) return salvo === null || (Number.isInteger(salvo) && salvo >= 1 && salvo <= 5);
    if (!salvo || typeof salvo !== 'object') return false;
    if ('valor' in base) {
      if (typeof salvo.valor !== 'string' || typeof salvo.outro !== 'string') return false;
      // Rascunho de múltipla escolha só é aproveitado se a opção ainda
      // existir no cardápio atual (ou for vazio) — o cardápio pode mudar sem
      // trocar a versão do formulário. "Outro" só onde a pergunta ainda o
      // aceita (M-6).
      if (!regra || salvo.valor === '') return true;
      if (salvo.valor === OUTRO) return regra.permiteOutro;
      return regra.opcoes.indexOf(salvo.valor) >= 0;
    }
    return (
      Array.isArray(salvo.marcadas) &&
      salvo.marcadas.every(function (m) { return typeof m === 'string'; }) &&
      typeof salvo.outroMarcado === 'boolean' &&
      typeof salvo.outro === 'string'
    );
  }

  /** M-6: caixas do rascunho só com opções que ainda existem e "Outro" só se a pergunta ainda o aceita. */
  function ajustarCaixas(salvo, regra) {
    if (!regra) return salvo;
    return {
      marcadas: salvo.marcadas.filter(function (m) { return regra.opcoes.indexOf(m) >= 0; }),
      outroMarcado: regra.permiteOutro ? salvo.outroMarcado : false,
      outro: regra.permiteOutro ? salvo.outro : '',
    };
  }

  function aproveitarResposta(base, salvo, regra) {
    if (!mesmoFormato(base, salvo, regra)) return base;
    return base !== null && typeof base === 'object' && 'marcadas' in base ? ajustarCaixas(salvo, regra) : salvo;
  }

  /**
   * Rascunho → estado atual, campo a campo. Só entra o que o estado de hoje
   * tem: Instagram e endereço de um rascunho da página anterior ficam de
   * fora (não voltam, não vão no envio, não são regravados).
   */
  function mesclarDados(base, salvo) {
    if (!salvo || typeof salvo !== 'object') return base;
    var regrasPorPergunta = base._regrasPorPergunta || {};
    var respostas = {};
    Object.keys(base.respostas).forEach(function (id) {
      var s = salvo.respostas ? salvo.respostas[id] : undefined;
      respostas[id] = aproveitarResposta(base.respostas[id], s, regrasPorPergunta[id]);
    });
    return {
      email: texto(salvo.email),
      nome: texto(salvo.nome),
      whatsapp: texto(salvo.whatsapp),
      respostas: respostas,
      consentimento: salvo.consentimento === true,
    };
  }

  /**
   * Leva respostas de OUTRA versão do formulário (409 ou CDN com cache) para a
   * versão `formulario`: mescla o que ainda vale e zera a autorização — o
   * texto dela vem do servidor e pode ter mudado com a versão (O-1).
   */
  function migrarDados(formulario, dados) {
    return definir(mesclarDados(estadoInicial(formulario), dados), 'consentimento', false);
  }

  function distancia(a, b) {
    var anterior = [];
    for (var j = 0; j <= b.length; j++) anterior.push(j);
    for (var i = 1; i <= a.length; i++) {
      var atual = [i];
      for (var k = 1; k <= b.length; k++) {
        atual.push(Math.min(atual[k - 1] + 1, anterior[k] + 1, anterior[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1)));
      }
      anterior = atual;
    }
    return anterior[b.length];
  }

  function sugerirEmail(email) {
    var e = texto(email).trim().toLowerCase();
    var arroba = e.lastIndexOf('@');
    if (arroba < 1) return null;
    var local = e.slice(0, arroba);
    var dominio = e.slice(arroba + 1);
    if (!dominio || DOMINIOS.indexOf(dominio) >= 0) return null;
    var melhor = null;
    var menor = 3;
    DOMINIOS.forEach(function (d) {
      var dist = distancia(dominio, d);
      if (dist < menor) {
        menor = dist;
        melhor = d;
      }
    });
    return melhor ? local + '@' + melhor : null;
  }

  /**
   * I-3 (Armadilha 2 de src/lib/phone.ts no dashboard): sem "+", nunca cortar
   * em 11 dígitos — "55 19 99999-9999" virava "(55) 19999-9999", um número
   * incompleto. O zero de discagem na frente cai (igual ao servidor); se ainda
   * sobram mais de 11 dígitos, é número com DDI: vira "+" + dígitos (até 15).
   */
  function mascaraWhatsapp(valor) {
    var v = texto(valor);
    if (v.trim().charAt(0) === '+') return '+' + v.replace(/\D/g, '').slice(0, 15);
    var d = v.replace(/\D/g, '').replace(/^0+/, '');
    if (d.length > 11) return '+' + d.slice(0, 15);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }

  function entre(valor, min, max) {
    var t = texto(valor).trim();
    if (t.length < min) return MENSAGENS.obrigatorio;
    if (t.length > max) return MENSAGENS.longo;
    return null;
  }

  function validarContato(chave, d) {
    if (chave === 'email') {
      var e = texto(d.email).trim().toLowerCase();
      return e.length <= 254 && EMAIL.test(e) ? null : MENSAGENS.email;
    }
    if (chave === 'nome') return entre(d.nome, 3, 120);
    var n = texto(d.whatsapp).replace(/\D/g, '').length;
    return n >= 10 && n <= 15 ? null : MENSAGENS.whatsapp;
  }

  function validarPergunta(p, r) {
    if (p.tipo === 'texto_curto' || p.tipo === 'paragrafo') {
      var t = texto(r).trim();
      if (!t) return p.obrigatoria ? MENSAGENS.obrigatorio : null;
      return t.length > (p.tipo === 'paragrafo' ? 3000 : 300) ? MENSAGENS.longo : null;
    }
    if (p.tipo === 'escala') return Number.isInteger(r) || !p.obrigatoria ? null : MENSAGENS.escolha;
    if (p.tipo === 'multipla_escolha') {
      if (!r || !r.valor) return p.obrigatoria ? MENSAGENS.escolha : null;
      if (r.valor !== OUTRO) return p.opcoes.indexOf(r.valor) >= 0 ? null : MENSAGENS.escolha;
      if (!p.permiteOutro) return MENSAGENS.escolha; // M-6: "Outro" onde a pergunta não aceita
      var o = texto(r.outro).trim();
      if (!o) return MENSAGENS.outro;
      return o.length > 200 ? MENSAGENS.longo : null;
    }
    // Só conta o que montarRespostas de fato envia: opções do cardápio atual e
    // "Outro" apenas onde a pergunta o aceita (M-6).
    var validas = r ? r.marcadas.filter(function (m) { return p.opcoes.indexOf(m) >= 0; }) : [];
    var comOutro = !!r && r.outroMarcado && !!p.permiteOutro;
    if (validas.length === 0 && !comOutro) return p.obrigatoria ? MENSAGENS.marque : null;
    if (!comOutro) return null;
    var ot = texto(r.outro).trim();
    if (!ot) return MENSAGENS.outro;
    return ot.length > 200 ? MENSAGENS.longo : null;
  }

  /**
   * Erros da etapa visível `n` (1 = primeira): os contatos ficam na
   * primeira, as perguntas em cada uma e a autorização no fim da última.
   */
  function errosDaEtapa(n, d, formulario) {
    var erros = {};
    function anotar(chave, mensagem) {
      if (mensagem) erros[chave] = mensagem;
    }
    if (n === 1) {
      CONTATOS.forEach(function (c) {
        anotar(c, validarContato(c, d));
      });
    }
    var etapa = etapasVisiveis(formulario)[n - 1];
    (etapa ? etapa.perguntas : []).forEach(function (p) {
      anotar('respostas.' + p.id, validarPergunta(p, d.respostas[p.id]));
    });
    if (n === totalEtapas(formulario)) {
      anotar('consentimento', d.consentimento === true ? null : MENSAGENS.consentimento);
    }
    return erros;
  }

  /**
   * Primeira etapa visível com erro; se nenhuma tem erro, `atual` (409 e
   * rascunho migrado, N-2) — já limitada às etapas que existem.
   */
  function primeiraEtapaComErro(dados, formulario, atual) {
    var total = totalEtapas(formulario);
    for (var n = 1; n <= total; n++) {
      if (Object.keys(errosDaEtapa(n, dados, formulario)).length) return n;
    }
    return limitarEtapa(atual, formulario);
  }

  function etapaDoCampo(chave, formulario) {
    if (chave === 'consentimento') return totalEtapas(formulario);
    if (chave.indexOf('respostas.') === 0) {
      var id = chave.slice('respostas.'.length);
      var visiveis = etapasVisiveis(formulario);
      for (var i = 0; i < visiveis.length; i++) {
        var achou = visiveis[i].perguntas.some(function (p) { return p.id === id; });
        if (achou) return i + 1;
      }
    }
    return 1;
  }

  function montarRespostas(formulario, respostas) {
    var saida = {};
    perguntasDe(formulario).forEach(function (p) {
      var r = respostas[p.id];
      if (p.tipo === 'texto_curto' || p.tipo === 'paragrafo') {
        var t = texto(r).trim();
        if (t) saida[p.id] = t;
        return;
      }
      if (p.tipo === 'escala') {
        if (Number.isInteger(r)) saida[p.id] = r;
        return;
      }
      if (p.tipo === 'multipla_escolha') {
        if (!r || !r.valor) return;
        if (r.valor !== OUTRO) saida[p.id] = { opcao: r.valor };
        else if (p.permiteOutro) saida[p.id] = { outro: texto(r.outro).trim() }; // M-6: nunca "outro" onde não é aceito
        return;
      }
      var marcadas = p.opcoes.filter(function (o) { return !!r && r.marcadas.indexOf(o) >= 0; });
      var outro = r && r.outroMarcado && p.permiteOutro ? texto(r.outro).trim() : '';
      if (marcadas.length || outro) saida[p.id] = { opcoes: marcadas, outro: outro || null };
    });
    return saida;
  }

  /** Corpo do POST: sem Instagram e sem endereço (o servidor aceita sem as duas coisas). */
  function montarEnvio(formulario, d, canal, inicioMs, agoraMs, honeypot) {
    var duracaoS = Math.round((agoraMs - inicioMs) / 1000);
    return {
      edicao: formulario.edicao,
      versao: formulario.versao,
      email: texto(d.email).trim(),
      nome: texto(d.nome).trim(),
      whatsapp: texto(d.whatsapp).trim(),
      respostas: montarRespostas(formulario, d.respostas),
      consentimento: d.consentimento === true,
      canal: canal,
      tempoPreenchimentoS: Number.isFinite(duracaoS) ? Math.max(0, duracaoS) : 0,
      empresa_site: texto(honeypot),
    };
  }

  window.CredNucleo = Object.freeze({
    OUTRO: OUTRO,
    MENSAGENS: MENSAGENS,
    apiBase: apiBase,
    lerCanal: lerCanal,
    lerPrefill: lerPrefill,
    armazenamento: armazenamento,
    carregarRascunho: carregarRascunho,
    salvarRascunho: salvarRascunho,
    apagarRascunho: apagarRascunho,
    formularioValido: formularioValido,
    etapasVisiveis: etapasVisiveis,
    totalEtapas: totalEtapas,
    limitarEtapa: limitarEtapa,
    estadoInicial: estadoInicial,
    definir: definir,
    obter: obter,
    mesclarDados: mesclarDados,
    migrarDados: migrarDados,
    sugerirEmail: sugerirEmail,
    mascaraWhatsapp: mascaraWhatsapp,
    validarPergunta: validarPergunta,
    errosDaEtapa: errosDaEtapa,
    primeiraEtapaComErro: primeiraEtapaComErro,
    etapaDoCampo: etapaDoCampo,
    montarEnvio: montarEnvio,
  });
})();
