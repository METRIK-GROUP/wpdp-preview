// credenciamento/tela.js
// Tela da página de credenciamento: busca o cardápio no servidor, monta as 4
// etapas, guarda rascunho no aparelho, preenche o endereço pelo CEP e envia.
// Regras sem tela ficam em nucleo.js (window.CredNucleo).
(function () {
  'use strict';

  var N = window.CredNucleo;
  var app = document.getElementById('app');
  var LIMITE_MS = 15000;
  var LIMITE_CEP_MS = 5000;
  var armazem = N.armazenamento();
  var temporizador = null;
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
    ultimoCep: '',
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
    // Depois do sucesso (ou do encerramento) nada volta a gravar rascunho.
    if (estado.concluido || !estado.formulario || !estado.dados) return;
    N.salvarRascunho(armazem, { versao: estado.formulario.versao, etapa: estado.etapa, inicio: estado.inicio, dados: estado.dados });
  }

  function salvarDepois() {
    clearTimeout(temporizador);
    temporizador = setTimeout(salvarAgora, 300);
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
      if (!primeiro) primeiro = entrada || (campo ? campo.querySelector('input, select, textarea') : null);
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
      outro.hidden = valor !== N.OUTRO;
      if (valor === N.OUTRO) outro.focus();
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

  function preencherSeVeio(chave, valor) {
    if (!valor) return;
    var entrada = document.getElementById(idEntrada(chave));
    if (entrada) entrada.value = valor;
    mudar(chave, valor);
  }

  function buscarCep(valor, status) {
    var cep = valor.replace(/\D/g, '');
    if (cep.length !== 8 || cep === estado.ultimoCep) return;
    estado.ultimoCep = cep;
    status.textContent = 'Buscando o endereço…';
    buscar('https://viacep.com.br/ws/' + cep + '/json/', {}, LIMITE_CEP_MS)
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (r) {
        if (!r || r.erro) {
          status.textContent = N.MENSAGENS.cepNaoEncontrado;
          return;
        }
        preencherSeVeio('endereco.logradouro', r.logradouro);
        preencherSeVeio('endereco.bairro', r.bairro);
        preencherSeVeio('endereco.cidade', r.localidade);
        preencherSeVeio('endereco.uf', r.uf);
        status.textContent = 'Endereço encontrado. Confira e informe o número.';
      })
      .catch(function () {
        status.textContent = N.MENSAGENS.cepNaoEncontrado;
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
    return el('div', { classe: 'campo-oculto', 'aria-hidden': 'true' }, [
      el('label', { for: 'empresa_site', texto: 'Não preencha este campo' }),
      el('input', { type: 'text', id: 'empresa_site', name: 'empresa_site', tabindex: '-1', autocomplete: 'off' }),
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
        else enviar();
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
    form.appendChild(el('div', { id: 'aviso-envio' }));
    form.appendChild(acoes());
    app.appendChild(form);
  }

  function focarTitulo() {
    var titulo = document.getElementById('titulo-etapa');
    if (!titulo) return;
    titulo.focus();
    if (titulo.scrollIntoView) titulo.scrollIntoView({ block: 'start' });
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
    focarTitulo();
  }

  function voltar() {
    estado.etapa = Math.max(1, estado.etapa - 1);
    salvarAgora();
    render();
    focarTitulo();
  }

  function comecarDoZero() {
    N.apagarRascunho(armazem);
    estado.dados = N.estadoInicial(estado.formulario);
    estado.etapa = 1;
    estado.inicio = null;
    estado.ultimoCep = '';
    render();
    focarTitulo();
  }

  // ---------------------------------------------------------------- envio
  function marcarBotao(ocupado) {
    var botao = document.getElementById('botao-principal');
    if (!botao) return;
    botao.disabled = ocupado;
    botao.textContent = ocupado ? 'Enviando…' : estado.etapa < 4 ? 'Próximo' : 'Confirmar meu credenciamento';
  }

  function avisoEnvio(mensagem, comRecarregar) {
    var caixa = document.getElementById('aviso-envio');
    if (!caixa) return;
    limpar(caixa);
    caixa.appendChild(el('p', { classe: 'aviso aviso--erro', role: 'alert' }, [
      mensagem,
      comRecarregar ? el('button', { type: 'button', texto: 'Recarregar a página', onclick: function () { salvarAgora(); window.location.reload(); } }) : null,
    ]));
  }

  function concluir() {
    estado.concluido = true;
    clearTimeout(temporizador);
    N.apagarRascunho(armazem);
  }

  function tratarResposta(status, dados) {
    if (status === 201 && dados && dados.ok && /^https:\/\//.test(dados.centralUrl || '')) {
      concluir();
      gtm('credenciamento_enviado');
      renderSucesso(dados);
      return;
    }
    if (status === 400 && dados && dados.campos) {
      irParaErros(dados.campos);
      avisoEnvio(dados.erro || 'Revise os campos destacados.', false);
      return;
    }
    if (status === 409) {
      salvarAgora();
      avisoEnvio((dados && dados.erro) || 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.', true);
      return;
    }
    if (status === 410) {
      concluir();
      renderEncerrado();
      return;
    }
    avisoEnvio((dados && dados.erro) || N.MENSAGENS.falhaEnvio, false);
  }

  function enviar() {
    if (estado.enviando) return;
    for (var n = 1; n <= 4; n++) {
      var erros = N.errosDaEtapa(n, estado.dados, estado.formulario);
      if (Object.keys(erros).length) {
        irParaErros(erros);
        return;
      }
    }
    estado.enviando = true;
    marcarBotao(true);
    var caixa = document.getElementById('aviso-envio');
    if (caixa) limpar(caixa);
    var oculto = document.getElementById('empresa_site');
    var corpo = N.montarEnvio(estado.formulario, estado.dados, estado.canal, estado.inicio || Date.now(), Date.now(), oculto ? oculto.value : '');
    buscar(N.apiBase(window.location) + '/api/public/credenciamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (dados) { tratarResposta(res.status, dados); });
      })
      .catch(function () { avisoEnvio(N.MENSAGENS.falhaEnvio, false); })
      .finally(function () {
        estado.enviando = false;
        marcarBotao(false);
      });
  }

  // ------------------------------------------------------- telas finais
  function mostrarLinkParaCopiar(botao, url) {
    var campo = el('input', { type: 'text', readonly: true, 'aria-label': 'Seu link pessoal', value: url });
    botao.replaceWith(campo);
    campo.focus();
    campo.select();
  }

  function botaoCopiar(url) {
    var botao = el('button', { type: 'button', classe: 'botao botao--secundario botao--largo', texto: 'Copiar meu link' });
    botao.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { botao.textContent = 'Link copiado ✓'; },
          function () { mostrarLinkParaCopiar(botao, url); },
        );
      } else {
        mostrarLinkParaCopiar(botao, url);
      }
    });
    return botao;
  }

  function renderSucesso(r) {
    limpar(app);
    var filhos = [
      el('h2', { id: 'titulo-sucesso', tabindex: '-1', texto: '✅ Credenciamento confirmado, ' + r.primeiroNome + '!' }),
      el('p', { texto: 'Seu acesso à Central do Workshop está pronto.' }),
      el('a', { classe: 'botao botao--primario botao--largo', href: r.centralUrl, texto: 'Acessar a Central do Workshop' }),
    ];
    if (r.emailEnviado) {
      filhos.push(el('p', {}, [
        'Também enviamos esse link para ',
        el('strong', { texto: String(N.obter(estado.dados, 'email') || '').trim() }),
        '. Guarde o e-mail: ele é o seu acesso pessoal.',
      ]));
    } else {
      filhos.push(el('p', { texto: 'Não conseguimos enviar o e-mail agora; vamos tentar de novo nos próximos minutos. Enquanto isso, guarde este link:' }));
      filhos.push(botaoCopiar(r.centralUrl));
    }
    filhos.push(el('a', {
      classe: 'botao botao--secundario botao--largo', href: estado.formulario.grupoUrl,
      target: '_blank', rel: 'noopener noreferrer', texto: 'Entrar no grupo dos participantes',
    }));
    filhos.push(el('p', { classe: 'ajuda', texto: 'Algo errado nas respostas? É só preencher de novo: vale o envio mais recente.' }));
    app.appendChild(el('div', { classe: 'sucesso' }, filhos));
    document.getElementById('titulo-sucesso').focus();
  }

  function renderEncerrado() {
    limpar(app);
    app.setAttribute('aria-busy', 'false');
    var numero = String((estado.formulario && estado.formulario.edicao) || '').replace(/\D/g, '');
    app.appendChild(el('div', { classe: 'sucesso' }, [
      el('h2', { id: 'titulo-encerrado', tabindex: '-1', texto: 'O credenciamento da ' + (numero ? numero + 'ª ' : '') + 'edição foi encerrado.' }),
      el('p', {}, ['Dúvidas? Fale com o suporte: ', el('a', { href: 'https://www.rodrigorosar.com.br/suporte', target: '_blank', rel: 'noopener noreferrer', texto: 'rodrigorosar.com.br/suporte' })]),
    ]));
  }

  function renderFalhaCarga() {
    limpar(app);
    app.setAttribute('aria-busy', 'false');
    app.appendChild(el('div', { classe: 'sucesso' }, [
      el('p', { classe: 'aviso aviso--erro', role: 'alert', texto: 'Não conseguimos carregar o formulário agora. Verifique sua internet e tente de novo.' }),
      el('button', { type: 'button', classe: 'botao botao--primario botao--largo', texto: 'Tentar de novo', onclick: function () { carregar(); } }),
      el('p', {}, [el('a', { href: 'https://www.rodrigorosar.com.br/suporte', target: '_blank', rel: 'noopener noreferrer', texto: 'Falar com o suporte' })]),
    ]));
  }

  // ---------------------------------------------------------------- início
  function iniciar(f) {
    estado.formulario = f;
    var guardado = N.carregarRascunho(armazem);
    if (guardado && guardado.versao === f.versao && guardado.dados) {
      estado.dados = N.mesclarDados(N.estadoInicial(f), guardado.dados);
      estado.etapa = Math.min(Math.max(1, Number(guardado.etapa) || 1), 4);
      estado.inicio = Number(guardado.inicio) || null;
      estado.restaurado = true;
    } else {
      if (guardado) N.apagarRascunho(armazem);
      estado.dados = N.estadoInicial(f);
    }
    var pre = N.lerPrefill(window.location.hash);
    if (pre.email && !estado.dados.email) estado.dados = N.definir(estado.dados, 'email', pre.email);
    if (pre.nome && !estado.dados.nome) estado.dados = N.definir(estado.dados, 'nome', pre.nome);
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    render();
  }

  function carregar() {
    limpar(app);
    app.setAttribute('aria-busy', 'true');
    app.appendChild(el('div', { classe: 'esqueleto', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]));
    buscar(N.apiBase(window.location) + '/api/public/credenciamento/formulario', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (f) {
        if (!f || !Array.isArray(f.etapas) || f.etapas.length !== 4) throw new Error('formato inesperado');
        estado.formulario = f;
        if (!f.aberto) {
          renderEncerrado();
          return;
        }
        iniciar(f);
      })
      .catch(renderFalhaCarga);
  }

  carregar();
})();
