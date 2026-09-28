// credenciamento/tela.js
// Tela da página de credenciamento: busca o cardápio no servidor, monta as 4
// etapas, guarda rascunho no aparelho e preenche o endereço pelo CEP. Regras
// sem tela ficam em nucleo.js (window.CredNucleo); o envio em si e as telas
// de resultado (sucesso/encerrado/erros do servidor) ficam em envio.js
// (window.CredEnvio), que este arquivo monta por injeção de dependência ao
// final (ver `var envio = window.CredEnvio.criar({...})`).
(function () {
  'use strict';

  var N = window.CredNucleo;
  var app = document.getElementById('app');
  var LIMITE_MS = 15000;
  var LIMITE_CEP_MS = 5000;
  var PAUSA_TOQUE_MS = 350;
  var armazem = N.armazenamento();
  var temporizador = null;
  var relogioToque = null;
  // Lido e apagado do endereço da página ANTES de qualquer busca ao servidor
  // (I-2): mesmo que o formulário nunca carregue, o e-mail/nome não ficam
  // expostos na URL (histórico do navegador, GTM, prints de tela). O script
  // em linha do <head> (antes do GTM) já leu e apagou o "#" com e-mail/nome e
  // deixou o valor em window.__credPrefill — consumido e apagado aqui.
  var PREFILL = N.lerPrefill(window.__credPrefill || window.location.hash);
  delete window.__credPrefill;
  if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
  var estado = {
    formulario: null,
    etapa: 1,
    dados: null,
    inicio: null,
    canal: N.lerCanal(window.location.search),
    enviando: false,
    iniciou: false,
    restaurado: false,
    concluido: false,
    migrar: false, // I-2/N-1: rascunho marcado por um 409 — mesclável vindo de outra versão da MESMA edição
    ultimoCep: '',
    cepAutoPreenchido: { logradouro: null, bairro: null, cidade: null, uf: null },
  };

  // ------------------------------------------------------------------ DOM
  function el(tag, atributos, filhos) {
    var no = document.createElement(tag);
    Object.keys(atributos || {}).forEach(function (nome) {
      var valor = atributos[nome];
      if (valor === null || valor === undefined || valor === false) return;
      if (nome === 'texto') no.textContent = valor;
      else if (nome === 'classe') no.className = valor;
      else if (nome.indexOf('on') === 0 && typeof valor === 'function') no.addEventListener(nome.slice(2), valor);
      else no.setAttribute(nome, valor === true ? '' : String(valor));
    });
    (filhos || []).forEach(function (filho) {
      if (filho === null || filho === undefined || filho === false) return;
      no.appendChild(typeof filho === 'string' ? document.createTextNode(filho) : filho);
    });
    return no;
  }

  function limpar(no) {
    while (no.firstChild) no.removeChild(no.firstChild);
  }
  function sufixo(chave) {
    return chave.replace(/\./g, '-');
  }
  function idCampo(chave) {
    return 'campo-' + sufixo(chave);
  }
  function idEntrada(chave) {
    return 'in-' + sufixo(chave);
  }
  function idErro(chave) {
    return 'erro-' + sufixo(chave);
  }

  function gtm(evento, extra) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: evento }, extra || {}));
  }

  function buscar(url, opcoes, limite) {
    var controle = new AbortController();
    var relogio = setTimeout(function () { controle.abort(); }, limite || LIMITE_MS);
    return fetch(url, Object.assign({}, opcoes || {}, { signal: controle.signal })).finally(function () {
      clearTimeout(relogio);
    });
  }

  // --------------------------------------------------------------- estado
  function marcarInicio() {
    if (!estado.inicio) estado.inicio = Date.now();
    if (!estado.iniciou) {
      estado.iniciou = true;
      gtm('credenciamento_inicio');
    }
  }

  function salvarAgora() {
    clearTimeout(temporizador);
    temporizador = null;
    // Depois do sucesso (ou do encerramento) nada volta a gravar rascunho.
    if (estado.concluido || !estado.formulario || !estado.dados) return;
    var edicao = estado.formulario.edicao;
    var rascunho = { edicao: edicao, versao: estado.formulario.versao, etapa: estado.etapa, inicio: estado.inicio, dados: estado.dados };
    N.salvarRascunho(armazem, estado.migrar ? Object.assign({ migrar: edicao }, rascunho) : rascunho);
  }

  function salvarDepois() {
    clearTimeout(temporizador);
    temporizador = setTimeout(salvarAgora, 300);
  }

  // Ponte para envio.js: `temporizador` é uma variável mutável só deste
  // fechamento (closure) — em vez de expor a variável crua, expomos só a
  // capacidade de zerá-la (usada por `concluir()` depois de um envio certo
  // ou de um 410).
  function pararTemporizador() {
    clearTimeout(temporizador);
    temporizador = null;
  }

  // M-3: grava na hora a alteração que ainda esperava os 300 ms quando a
  // pessoa sai da página ou a esconde (troca de aba/app, tela bloqueada).
  function salvarPendente() {
    if (temporizador !== null) salvarAgora();
  }

  function mudar(chave, valor) {
    marcarInicio();
    estado.dados = N.definir(estado.dados, chave, valor);
    limparErro(chave);
    salvarDepois();
  }

  // ---------------------------------------------------------------- erros
  function limparErro(chave) {
    var erro = document.getElementById(idErro(chave));
    if (erro) {
      erro.textContent = '';
      erro.hidden = true;
    }
    var entrada = document.getElementById(idEntrada(chave));
    if (entrada) entrada.removeAttribute('aria-invalid');
    var campo = document.getElementById(idCampo(chave));
    if (campo) campo.removeAttribute('data-invalido');
  }

  function anunciar(mensagem) {
    var regiao = document.getElementById('status');
    if (!regiao) return;
    regiao.textContent = '';
    setTimeout(function () { regiao.textContent = mensagem; }, 50);
  }

  /**
   * Qual controle focar para o erro de uma chave. Normalmente é a própria
   * entrada (`#in-<chave>`) ou o primeiro campo do grupo — MAS se o grupo tem
   * a caixa "Outro" aberta (`.outro-texto` visível), é ela quem precisa da
   * atenção (M-3): a pessoa já escolheu "Outro", o problema é o texto que
   * falta escrever ali, não a primeira opção da lista.
   */
  function primeiroControleDoCampo(chave) {
    var entrada = document.getElementById(idEntrada(chave));
    if (entrada) return entrada;
    var campo = document.getElementById(idCampo(chave));
    if (!campo) return null;
    var outro = campo.querySelector('.outro-texto');
    if (outro && !outro.hidden) return outro;
    return campo.querySelector('input, select, textarea');
  }

  function mostrarErros(erros) {
    var chaves = Object.keys(erros);
    var primeiro = null;
    chaves.forEach(function (chave) {
      var erro = document.getElementById(idErro(chave));
      if (!erro) return;
      erro.textContent = erros[chave];
      erro.hidden = false;
      var entrada = document.getElementById(idEntrada(chave));
      var campo = document.getElementById(idCampo(chave));
      if (entrada) entrada.setAttribute('aria-invalid', 'true');
      else if (campo) campo.setAttribute('data-invalido', '');
      if (!primeiro) primeiro = primeiroControleDoCampo(chave);
    });
    if (chaves.length) anunciar('Revise ' + chaves.length + (chaves.length === 1 ? ' campo destacado.' : ' campos destacados.'));
    if (primeiro) {
      primeiro.focus();
      if (primeiro.scrollIntoView) primeiro.scrollIntoView({ block: 'center' });
    }
  }

  function irParaErros(erros) {
    var etapas = Object.keys(erros).map(function (chave) { return N.etapaDoCampo(chave, estado.formulario); });
    var alvo = etapas.length ? Math.min.apply(null, etapas) : estado.etapa;
    if (alvo !== estado.etapa) {
      estado.etapa = alvo;
      salvarAgora();
      render();
    }
    mostrarErros(erros);
  }

  // --------------------------------------------------------------- campos
  function marcaObrigatoria(obrigatoria, legenda) {
    if (!obrigatoria) return [];
    var nos = [el('span', { classe: 'obrig', 'aria-hidden': 'true', texto: '*' })];
    if (legenda) nos.push(el('span', { classe: 'sr-only', texto: ' (obrigatória)' }));
    return nos;
  }

  function campoTexto(chave, rotulo, o) {
    var opcoes = o || {};
    var id = idEntrada(chave);
    var descritores = [];
    var filhos = [el('label', { for: id }, [rotulo].concat(marcaObrigatoria(opcoes.obrigatoria, false)))];
    if (opcoes.ajuda) {
      filhos.push(el('p', { classe: 'ajuda', id: id + '-ajuda', texto: opcoes.ajuda }));
      descritores.push(id + '-ajuda');
    }
    descritores.push(idErro(chave));
    var entrada = el(opcoes.multilinha ? 'textarea' : 'input', {
      id: id,
      name: chave,
      type: opcoes.multilinha ? null : opcoes.tipo || 'text',
      autocomplete: opcoes.autocomplete || 'off',
      inputmode: opcoes.inputmode,
      maxlength: opcoes.max,
      'aria-required': opcoes.obrigatoria ? 'true' : null,
      'aria-describedby': descritores.join(' '),
      oninput: function (ev) {
        var alvo = ev.target;
        if (opcoes.mascara) {
          var mascarado = opcoes.mascara(alvo.value);
          if (mascarado !== alvo.value) alvo.value = mascarado;
        }
        mudar(chave, alvo.value);
        if (opcoes.aoDigitar) opcoes.aoDigitar(alvo.value);
      },
      onblur: opcoes.aoSair ? function (ev) { opcoes.aoSair(ev.target.value); } : null,
    });
    entrada.value = N.obter(estado.dados, chave) || '';
    filhos.push(opcoes.prefixo ? el('div', { classe: 'prefixo' }, [el('span', { 'aria-hidden': 'true', texto: opcoes.prefixo }), entrada]) : entrada);
    if (opcoes.extra) filhos.push(opcoes.extra);
    filhos.push(el('p', { classe: 'erro-campo', id: idErro(chave), hidden: true }));
    return el('div', { classe: 'campo', id: idCampo(chave) }, filhos);
  }

  function grupo(p, chave, conteudo) {
    var idAjuda = idEntrada(chave) + '-ajuda';
    var filhos = [el('legend', {}, [p.rotulo].concat(marcaObrigatoria(p.obrigatoria, true)))];
    if (p.ajuda) filhos.push(el('p', { classe: 'ajuda', id: idAjuda, texto: p.ajuda }));
    filhos.push(conteudo);
    filhos.push(el('p', { classe: 'erro-campo', id: idErro(chave), hidden: true }));
    return el('fieldset', { classe: 'campo', id: idCampo(chave), 'data-pergunta': p.id, 'aria-describedby': (p.ajuda ? idAjuda + ' ' : '') + idErro(chave) }, filhos);
  }

  function opcaoMarcavel(tipo, nome, id, rotulo, marcado, aoMudar) {
    return el('label', { classe: 'opcao', for: id }, [
      el('input', { type: tipo, name: nome, id: id, checked: marcado, onchange: aoMudar }),
      el('span', { texto: rotulo }),
    ]);
  }

  function campoOutro(chave, visivel) {
    var atual = N.obter(estado.dados, chave);
    var entrada = el('input', {
      type: 'text',
      classe: 'outro-texto',
      'aria-label': 'Qual? (Outro)',
      'aria-describedby': idErro(chave), // M-3: erro do campo (ex. "Escreva qual é a outra opção.") é anunciado ao focar aqui
      maxlength: 200,
      hidden: !visivel,
      oninput: function (ev) { mudar(chave, Object.assign({}, N.obter(estado.dados, chave), { outro: ev.target.value })); },
    });
    entrada.value = atual.outro || '';
    return entrada;
  }

  function perguntaMultipla(p, chave) {
    var nome = idEntrada(chave);
    var atual = N.obter(estado.dados, chave);
    var outro = campoOutro(chave, atual.valor === N.OUTRO);
    function escolher(valor) {
      mudar(chave, Object.assign({}, N.obter(estado.dados, chave), { valor: valor }));
      // M-3 (WCAG 3.2.2): só revela a caixa "Outro" — nunca move o foco para
      // lá sozinho. O mesmo onchange dispara ao selecionar por clique OU por
      // seta do teclado, e mover o foco durante a navegação por setas tira a
      // pessoa do grupo de opções sem ela pedir.
      outro.hidden = valor !== N.OUTRO;
    }
    var itens = p.opcoes.map(function (opcao, i) {
      return opcaoMarcavel('radio', nome, nome + '-' + i, opcao, atual.valor === opcao, function () { escolher(opcao); });
    });
    if (p.permiteOutro) {
      itens.push(opcaoMarcavel('radio', nome, nome + '-outro', 'Outro', atual.valor === N.OUTRO, function () { escolher(N.OUTRO); }));
      itens.push(outro);
    }
    return grupo(p, chave, el('div', { classe: 'opcoes' }, itens));
  }

  function perguntaCaixas(p, chave) {
    var base = idEntrada(chave);
    var atual = N.obter(estado.dados, chave);
    var outro = campoOutro(chave, atual.outroMarcado);
    var itens = p.opcoes.map(function (opcao, i) {
      return opcaoMarcavel('checkbox', base + '-' + i, base + '-' + i, opcao, atual.marcadas.indexOf(opcao) >= 0, function (ev) {
        var agora = N.obter(estado.dados, chave);
        var marcadas = ev.target.checked
          ? agora.marcadas.concat([opcao])
          : agora.marcadas.filter(function (m) { return m !== opcao; });
        mudar(chave, Object.assign({}, agora, { marcadas: marcadas }));
      });
    });
    if (p.permiteOutro) {
      itens.push(opcaoMarcavel('checkbox', base + '-outro', base + '-outro', 'Outro', atual.outroMarcado, function (ev) {
        mudar(chave, Object.assign({}, N.obter(estado.dados, chave), { outroMarcado: ev.target.checked }));
        outro.hidden = !ev.target.checked;
        if (ev.target.checked) outro.focus();
      }));
      itens.push(outro);
    }
    return grupo(p, chave, el('div', { classe: 'opcoes' }, itens));
  }

  function perguntaEscala(p, chave) {
    var nome = idEntrada(chave);
    var atual = N.obter(estado.dados, chave);
    var itens = [1, 2, 3, 4, 5].map(function (n) {
      return opcaoMarcavel('radio', nome, nome + '-' + n, String(n), atual === n, function () { mudar(chave, n); });
    });
    return grupo(p, chave, el('div', { classe: 'escala' }, itens));
  }

  function renderPergunta(p) {
    var chave = 'respostas.' + p.id;
    if (p.tipo === 'texto_curto' || p.tipo === 'paragrafo') {
      var bloco = campoTexto(chave, p.rotulo, {
        multilinha: p.tipo === 'paragrafo',
        obrigatoria: p.obrigatoria,
        ajuda: p.ajuda,
        max: p.tipo === 'paragrafo' ? 3000 : 300,
      });
      bloco.setAttribute('data-pergunta', p.id);
      return bloco;
    }
    if (p.tipo === 'escala') return perguntaEscala(p, chave);
    if (p.tipo === 'multipla_escolha') return perguntaMultipla(p, chave);
    return perguntaCaixas(p, chave);
  }

  function mostrarSugestao(valor, caixa) {
    limpar(caixa);
    var sugestao = N.sugerirEmail(valor);
    caixa.hidden = !sugestao;
    if (!sugestao) return;
    caixa.appendChild(document.createTextNode('Você quis dizer '));
    caixa.appendChild(el('button', {
      type: 'button',
      texto: sugestao,
      onclick: function () {
        var entrada = document.getElementById(idEntrada('email'));
        entrada.value = sugestao;
        mudar('email', sugestao);
        caixa.hidden = true;
        entrada.focus();
      },
    }));
    caixa.appendChild(document.createTextNode('?'));
  }

  function campoInstagram(textos) {
    var bloco = campoTexto('instagram', textos.rotulo, { obrigatoria: true, max: 100, prefixo: '@' });
    var entrada = bloco.querySelector('input');
    entrada.disabled = estado.dados.semInstagram;
    var caixa = opcaoMarcavel('checkbox', 'semInstagram', 'in-sem-instagram', textos.semInstagram, estado.dados.semInstagram, function (ev) {
      marcarInicio();
      estado.dados = N.definir(estado.dados, 'semInstagram', ev.target.checked);
      entrada.disabled = ev.target.checked;
      limparErro('instagram');
      salvarDepois();
    });
    bloco.insertBefore(caixa, bloco.querySelector('.erro-campo'));
    return bloco;
  }

  function camposContato() {
    var t = estado.formulario.campos;
    var sugestao = el('p', { classe: 'sugestao', id: 'sugestao-email', 'aria-live': 'polite', hidden: true });
    return [
      campoTexto('email', t.email.rotulo, {
        tipo: 'email', autocomplete: 'email', inputmode: 'email', ajuda: t.email.ajuda, obrigatoria: true, max: 254,
        extra: sugestao,
        aoSair: function (v) { mostrarSugestao(v, sugestao); },
      }),
      campoTexto('nome', t.nome.rotulo, { autocomplete: 'name', obrigatoria: true, max: 120 }),
      campoTexto('whatsapp', t.whatsapp.rotulo, { tipo: 'tel', autocomplete: 'tel', inputmode: 'tel', obrigatoria: true, max: 20, mascara: N.mascaraWhatsapp }),
      campoInstagram(t.instagram),
    ];
  }

  /**
   * M-5: só preenche se o campo ainda está vazio OU ainda tem exatamente o
   * que a própria busca por CEP colocou da última vez (`cepAutoPreenchido`).
   * Se a pessoa já digitou algo diferente enquanto a resposta do ViaCEP
   * estava a caminho, essa resposta (possivelmente atrasada/fora de ordem)
   * não pisa em cima do que foi digitado.
   */
  function preencherSeVeio(chave, valor, sub) {
    if (!valor) return;
    var entrada = document.getElementById(idEntrada(chave));
    var atual = entrada ? entrada.value : N.obter(estado.dados, chave) || '';
    if (atual !== '' && atual !== estado.cepAutoPreenchido[sub]) return;
    estado.cepAutoPreenchido[sub] = valor;
    if (entrada) entrada.value = valor;
    mudar(chave, valor);
  }

  // M-4: a resposta do ViaCEP só vale se o campo ainda tem ESTE CEP — a
  // pessoa pode ter trocado o CEP enquanto a busca anterior estava a caminho.
  function cepAindaNoCampo(cep) {
    return String(N.obter(estado.dados, 'endereco.cep') || '').replace(/\D/g, '') === cep;
  }

  function buscarCep(valor, status) {
    var cep = valor.replace(/\D/g, '');
    if (cep.length !== 8) {
      status.textContent = ''; // CEP em edição: aviso de uma busca anterior não vale mais
      return;
    }
    if (cep === estado.ultimoCep) return;
    status.textContent = 'Buscando o endereço…';
    buscar('https://viacep.com.br/ws/' + cep + '/json/', {}, LIMITE_CEP_MS)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (r) {
        if (!cepAindaNoCampo(cep)) return;
        if (!r || r.erro) {
          status.textContent = N.MENSAGENS.cepNaoEncontrado;
          return;
        }
        // M-5: só marca como "resolvido" numa busca que deu certo — assim,
        // depois de uma falha, digitar o mesmo CEP de novo tenta de novo em
        // vez de ficar preso (o guard acima compara com ultimoCep).
        estado.ultimoCep = cep;
        preencherSeVeio('endereco.logradouro', r.logradouro, 'logradouro');
        preencherSeVeio('endereco.bairro', r.bairro, 'bairro');
        preencherSeVeio('endereco.cidade', r.localidade, 'cidade');
        preencherSeVeio('endereco.uf', r.uf, 'uf');
        status.textContent = 'Endereço encontrado. Confira e informe o número.';
      })
      .catch(function () {
        if (cepAindaNoCampo(cep)) status.textContent = N.MENSAGENS.cepNaoEncontrado;
      });
  }

  function campoUf() {
    var chave = 'endereco.uf';
    var id = idEntrada(chave);
    var opcoes = [el('option', { value: '', texto: 'Selecione' })].concat(
      N.UFS.map(function (uf) { return el('option', { value: uf, texto: uf }); }),
    );
    var selecao = el('select', {
      id: id, name: chave, autocomplete: 'address-level1', 'aria-required': 'true', 'aria-describedby': idErro(chave),
      onchange: function (ev) { mudar(chave, ev.target.value); },
    }, opcoes);
    selecao.value = N.obter(estado.dados, chave) || '';
    return el('div', { classe: 'campo', id: idCampo(chave) }, [
      el('label', { for: id }, ['Estado'].concat(marcaObrigatoria(true, false))),
      selecao,
      el('p', { classe: 'erro-campo', id: idErro(chave), hidden: true }),
    ]);
  }

  function blocoEndereco() {
    var t = estado.formulario.campos.endereco;
    var e = estado.dados.endereco;
    var status = el('p', { classe: 'ajuda', id: 'status-cep', 'aria-live': 'polite' });
    var brasil = el('div', { hidden: e.moraExterior }, [
      el('div', { classe: 'linha linha--cep' }, [
        campoTexto('endereco.cep', 'CEP', {
          inputmode: 'numeric', autocomplete: 'postal-code', obrigatoria: true, max: 9, mascara: N.mascaraCep,
          aoDigitar: function (v) { buscarCep(v, status); }, extra: status,
        }),
        campoTexto('endereco.logradouro', 'Rua', { autocomplete: 'address-line1', obrigatoria: true, max: 200 }),
      ]),
      el('div', { classe: 'linha linha--2' }, [
        campoTexto('endereco.numero', 'Número', { obrigatoria: true, max: 20 }),
        campoTexto('endereco.complemento', 'Complemento (opcional)', { autocomplete: 'address-line2', max: 100 }),
      ]),
      campoTexto('endereco.bairro', 'Bairro', { obrigatoria: true, max: 100 }),
      el('div', { classe: 'linha linha--2' }, [
        campoTexto('endereco.cidade', 'Cidade', { autocomplete: 'address-level2', obrigatoria: true, max: 100 }),
        campoUf(),
      ]),
    ]);
    var exterior = el('div', { hidden: !e.moraExterior }, [
      campoTexto('endereco.pais', 'País', { autocomplete: 'country-name', obrigatoria: true, max: 60 }),
      campoTexto('endereco.enderecoCompleto', 'Endereço completo', { multilinha: true, obrigatoria: true, max: 500 }),
    ]);
    var fora = opcaoMarcavel('checkbox', 'moraExterior', 'in-endereco-moraExterior', t.moraExterior, e.moraExterior, function (ev) {
      mudar('endereco.moraExterior', ev.target.checked);
      brasil.hidden = ev.target.checked;
      exterior.hidden = !ev.target.checked;
    });
    return el('div', { classe: 'endereco' }, [el('p', { classe: 'aviso', texto: t.texto }), fora, brasil, exterior]);
  }

  function blocoConsentimento() {
    var chave = 'consentimento';
    var caixa = el('input', {
      type: 'checkbox', id: idEntrada(chave), checked: estado.dados.consentimento, 'aria-describedby': idErro(chave),
      onchange: function (ev) { mudar(chave, ev.target.checked); },
    });
    return el('div', { classe: 'campo', id: idCampo(chave) }, [
      el('label', { classe: 'consentimento', for: idEntrada(chave) }, [caixa, el('span', { texto: estado.formulario.campos.consentimento })]),
      el('p', { classe: 'erro-campo', id: idErro(chave), hidden: true }),
    ]);
  }

  function campoOculto() {
    // M-9: id/name/rótulo neutros de propósito — um preenchimento automático
    // do navegador (autofill) tende a classificar campos chamados
    // "empresa"/"company"/"site" como dado de organização e preenchê-los de
    // verdade, o que faria uma pessoa real cair como "suspeito" (sem e-mail,
    // sem etiqueta). A chave enviada ao servidor continua "empresa_site"
    // (contrato do servidor, não muda). Fica fora da tela (não
    // display:none) para que um robô simples que preenche todo input ainda
    // caia na armadilha.
    return el('div', { classe: 'campo-oculto', 'aria-hidden': 'true' }, [
      el('label', { for: 'cred_campo_extra', texto: 'Deixe este campo em branco' }),
      el('input', { type: 'text', id: 'cred_campo_extra', name: 'cred_campo_extra', tabindex: '-1', autocomplete: 'off' }),
    ]);
  }

  // --------------------------------------------------------------- etapas
  function progresso() {
    var pct = Math.round((estado.etapa / 4) * 100);
    return el('div', { classe: 'progresso' }, [
      el('div', { classe: 'progresso__texto' }, [el('span', { texto: 'Etapa ' + estado.etapa + ' de 4' }), el('span', { texto: pct + '%' })]),
      el('div', {
        classe: 'progresso__barra', role: 'progressbar', 'aria-label': 'Progresso do credenciamento',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct),
      }, [el('span', { style: 'width:' + pct + '%' })]),
    ]);
  }

  function avisoRestaurado() {
    return el('p', { classe: 'aviso' }, [
      'Continuamos de onde você parou.',
      el('button', { type: 'button', texto: 'Começar do zero', onclick: comecarDoZero }),
    ]);
  }

  function acoes() {
    var filhos = [];
    if (estado.etapa > 1) filhos.push(el('button', { type: 'button', classe: 'botao botao--secundario', texto: 'Voltar', onclick: voltar }));
    filhos.push(el('button', {
      type: 'submit', id: 'botao-principal',
      classe: 'botao botao--primario' + (estado.etapa === 1 ? ' botao--largo' : ''),
      texto: estado.etapa < 4 ? 'Próximo' : 'Confirmar meu credenciamento',
    }));
    return el('div', { classe: 'acoes' }, filhos);
  }

  function render() {
    var f = estado.formulario;
    var etapa = f.etapas[estado.etapa - 1];
    limpar(app);
    app.setAttribute('aria-busy', 'false');
    var form = el('form', {
      novalidate: true,
      onsubmit: function (ev) {
        ev.preventDefault();
        if (estado.etapa < 4) avancar();
        else envio.enviar();
      },
    });
    form.appendChild(progresso());
    if (estado.restaurado) {
      form.appendChild(avisoRestaurado());
      estado.restaurado = false;
    }
    form.appendChild(el('h2', { classe: 'etapa__titulo', id: 'titulo-etapa', tabindex: '-1', texto: etapa.titulo }));
    if (etapa.ajuda) form.appendChild(el('p', { classe: 'etapa__ajuda', texto: etapa.ajuda }));
    if (estado.etapa === 1) camposContato().forEach(function (c) { form.appendChild(c); });
    etapa.perguntas.forEach(function (p) { form.appendChild(renderPergunta(p)); });
    if (estado.etapa === 4) {
      form.appendChild(blocoEndereco());
      form.appendChild(blocoConsentimento());
      form.appendChild(campoOculto());
    }
    form.appendChild(el('div', { id: 'status', classe: 'sr-only', 'aria-live': 'assertive' }));
    form.appendChild(el('div', { id: 'aviso-envio', tabindex: '-1' })); // M-3: precisa poder receber foco por script após 409/429/5xx/falha de rede
    form.appendChild(acoes());
    app.appendChild(form);
  }

  function focarTitulo() {
    var titulo = document.getElementById('titulo-etapa');
    if (!titulo) return;
    titulo.focus();
    if (titulo.scrollIntoView) titulo.scrollIntoView({ block: 'start' });
  }

  /**
   * I-4: logo depois de trocar de etapa, a etapa nova aparece embaixo do dedo
   * — o 2º toque de um toque duplo em "Próximo"/"Voltar" cairia numa opção
   * dela e marcaria (ou trocaria) uma resposta sozinho. Por ~350 ms o
   * formulário ignora toque e clique; o teclado segue funcionando.
   */
  function pausarToques() {
    clearTimeout(relogioToque);
    app.style.pointerEvents = 'none';
    relogioToque = setTimeout(function () { app.style.pointerEvents = ''; }, PAUSA_TOQUE_MS);
  }

  function avancar() {
    var erros = N.errosDaEtapa(estado.etapa, estado.dados, estado.formulario);
    if (Object.keys(erros).length) {
      mostrarErros(erros);
      return;
    }
    estado.etapa += 1;
    salvarAgora();
    gtm('credenciamento_etapa', { etapa: estado.etapa });
    render();
    pausarToques();
    focarTitulo();
  }

  function voltar() {
    estado.etapa = Math.max(1, estado.etapa - 1);
    salvarAgora();
    render();
    pausarToques();
    focarTitulo();
  }

  function comecarDoZero() {
    // M-2: apaga tudo o que a pessoa preencheu — confirma antes.
    if (!window.confirm('Apagar tudo o que você preencheu e começar do zero?')) return;
    N.apagarRascunho(armazem);
    estado.dados = N.estadoInicial(estado.formulario);
    estado.etapa = 1;
    estado.inicio = null;
    estado.ultimoCep = '';
    estado.migrar = false;
    render();
    focarTitulo();
  }

  // ------------------------------------------------------- telas finais
  // marcarBotao/avisoEnvio/tratarResposta/tratar409/tratarErros400/enviar/
  // renderSucesso/renderEncerrado moraram aqui até o fix round 2 — agora
  // vivem em envio.js (window.CredEnvio.criar), que recebe as dependências
  // abaixo por injeção. renderFalhaCarga fica em tela.js porque é a tela de
  // falha da CARGA inicial do cardápio, não do envio — e chama carregar()
  // de volta (par natural com carregar(), que também fica aqui).
  function renderFalhaCarga() {
    limpar(app);
    app.setAttribute('aria-busy', 'false');
    app.appendChild(el('div', { classe: 'sucesso' }, [
      el('p', { classe: 'aviso aviso--erro', role: 'alert', texto: 'Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.' }),
      el('button', { type: 'button', classe: 'botao botao--primario botao--largo', texto: 'Tentar de novo', onclick: function () { carregar(); } }),
      el('p', {}, [el('a', { classe: 'link-toque', href: 'https://www.rodrigorosar.com.br/suporte', target: '_blank', rel: 'noopener noreferrer', texto: 'Falar com o suporte' })]),
    ]));
  }

  // ---------------------------------------------------------------- início
  function iniciar(f) {
    estado.formulario = f;
    var guardado = N.carregarRascunho(armazem);
    // N-1: rascunho de outra edição nunca é aproveitado (nem com a mesma
    // versão de formulário, que uma edição nova pode reaproveitar).
    var mesmaEdicao = !!guardado && guardado.edicao === f.edicao;
    var mesmaVersao = mesmaEdicao && guardado.versao === f.versao;
    // I-2: de OUTRA versão, só se um 409 desta edição o marcou; sem
    // marcador, continua descartado (Review Focus #3).
    var marcado = mesmaEdicao && guardado.migrar === f.edicao;
    if (guardado && guardado.dados && (mesmaVersao || marcado)) {
      // O-1: vindo de outra versão, a autorização volta desmarcada.
      estado.dados = mesmaVersao ? N.mesclarDados(N.estadoInicial(f), guardado.dados) : N.migrarDados(f, guardado.dados);
      // M-6: rascunho corrompido (ex.: etapa 2.5, de uma gravação parcial ou
      // formato antigo) nunca pode virar uma etapa fora de 1..4 nem quebrar
      // com um número quebrado.
      var salva = Math.min(Math.max(1, Math.trunc(Number(guardado.etapa)) || 1), 4);
      // N-2: migrado abre na primeira etapa com erro, se ela vier antes da salva.
      estado.etapa = mesmaVersao ? salva : Math.min(salva, N.primeiraEtapaComErro(estado.dados, f, salva));
      estado.inicio = Number(guardado.inicio) || null;
      estado.restaurado = true;
      // I-2: o marcador fica até o rascunho ser apagado (envio certo, 410,
      // "Começar do zero") — a CDN pode alternar versões entre recargas.
      estado.migrar = marcado;
      if (!mesmaVersao) salvarAgora(); // regravado já na versão atual
    } else {
      if (guardado) N.apagarRascunho(armazem);
      estado.dados = N.estadoInicial(f);
    }
    if (PREFILL.email && !estado.dados.email) estado.dados = N.definir(estado.dados, 'email', PREFILL.email);
    if (PREFILL.nome && !estado.dados.nome) estado.dados = N.definir(estado.dados, 'nome', PREFILL.nome);
    render();
  }

  /**
   * Busca o cardápio no servidor e confere o formato mínimo. Usada tanto na
   * carga inicial quanto na recuperação do 409 (I-1) — nesse segundo caso,
   * `semCache: true` força ignorar o cache da CDN (query descartável +
   * `cache: 'no-store'`), porque um 409 significa que o cardápio ACABOU de
   * mudar no servidor e a resposta antiga em cache não serviria.
   */
  function buscarFormulario(opcoes) {
    var semCache = !!(opcoes && opcoes.semCache);
    var url = N.apiBase(window.location) + '/api/public/credenciamento/formulario';
    if (semCache) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
    var init = { headers: { Accept: 'application/json' } };
    if (semCache) init.cache = 'no-store';
    return buscar(url, init)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (f) {
        if (!f || !Array.isArray(f.etapas) || f.etapas.length !== 4) throw new Error('formato inesperado');
        return f;
      });
  }

  function carregar() {
    limpar(app);
    app.setAttribute('aria-busy', 'true');
    app.appendChild(el('div', { classe: 'esqueleto', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]));
    buscarFormulario()
      .then(function (f) {
        estado.formulario = f;
        if (!f.aberto) {
          envio.renderEncerrado();
          return;
        }
        iniciar(f);
      })
      .catch(renderFalhaCarga);
  }

  // Fábrica congelada (fix round 2): envio.js recebe por injeção só o que
  // precisa — o mesmo objeto `estado` por referência (mutações feitas por
  // envio.js aparecem aqui e vice-versa), sem nenhum estado global novo.
  var envio = window.CredEnvio.criar({
    estado: estado,
    N: N,
    el: el,
    limpar: limpar,
    buscar: buscar,
    buscarFormulario: buscarFormulario,
    render: render,
    irParaErros: irParaErros,
    mostrarErros: mostrarErros,
    salvarAgora: salvarAgora,
    pararTemporizador: pararTemporizador,
    armazem: armazem,
    gtm: gtm,
    app: app,
  });

  window.addEventListener('pagehide', salvarPendente);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') salvarPendente();
  });
  carregar();
})();
