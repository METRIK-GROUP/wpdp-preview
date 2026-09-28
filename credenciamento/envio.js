// credenciamento/envio.js
// Envio do credenciamento e telas de resultado: tratarResposta e seus ramos
// (201/400/409/410/429/5xx/falha de rede), enviar() e as telas de sucesso e
// de encerrado que aparecem depois de enviar. Fábrica congelada — recebe as
// dependências por injeção (o mesmo objeto `estado` de tela.js por
// referência, helpers de DOM, etc.); nenhum estado global novo é criado
// aqui. Regras sem tela ficam em nucleo.js (window.CredNucleo); montagem das
// etapas, navegação e carga inicial do formulário ficam em tela.js.
(function () {
  'use strict';

  window.CredEnvio = Object.freeze({
    /**
     * @param {object} ctx
     * @param {object} ctx.estado - o mesmo objeto de estado de tela.js (por referência)
     * @param {object} ctx.N - window.CredNucleo
     * @param {Function} ctx.el - helper de criação de elemento
     * @param {Function} ctx.limpar - esvazia um nó
     * @param {Function} ctx.buscar - fetch com timeout
     * @param {Function} ctx.buscarFormulario - busca o cardápio (usada na recuperação do 409)
     * @param {Function} ctx.render - reconstrói a tela da etapa atual
     * @param {Function} ctx.irParaErros - navega para a etapa de um conjunto de erros e os mostra
     * @param {Function} ctx.mostrarErros - mostra um conjunto de erros na etapa já renderizada
     * @param {Function} ctx.salvarAgora - grava o rascunho imediatamente
     * @param {Function} ctx.pararTemporizador - cancela o temporizador do rascunho pendente
     * @param {*} ctx.armazem - localStorage (ou null) já validado
     * @param {Function} ctx.gtm - envia evento ao dataLayer
     * @param {HTMLElement} ctx.app - #app
     * @returns {{ enviar: Function, renderEncerrado: Function }}
     */
    criar: function (ctx) {
      var estado = ctx.estado;
      var N = ctx.N;
      var el = ctx.el;
      var limpar = ctx.limpar;
      var buscar = ctx.buscar;
      var buscarFormulario = ctx.buscarFormulario;
      var render = ctx.render;
      var irParaErros = ctx.irParaErros;
      var mostrarErros = ctx.mostrarErros;
      var salvarAgora = ctx.salvarAgora;
      var pararTemporizador = ctx.pararTemporizador;
      var armazem = ctx.armazem;
      var gtm = ctx.gtm;
      var app = ctx.app;

      // ---------------------------------------------------------------- envio
      function marcarBotao(ocupado) {
        var botao = document.getElementById('botao-principal');
        if (!botao) return;
        botao.disabled = ocupado;
        botao.textContent = ocupado ? 'Enviando…' : estado.etapa < 4 ? 'Próximo' : 'Confirmar meu credenciamento';
      }

      /** `mensagem` + lista opcional de nós extra (botão/link) dentro do aviso. */
      function avisoEnvio(mensagem, extras) {
        var caixa = document.getElementById('aviso-envio');
        if (!caixa) return;
        limpar(caixa);
        caixa.appendChild(el('p', { classe: 'aviso aviso--erro', role: 'alert' }, [mensagem].concat(extras || [])));
      }

      // M-3: depois de 409/429/5xx/falha de rede, o foco vai para o próprio
      // aviso (não para um campo) — a pessoa precisa ler o que aconteceu antes
      // de continuar. `#aviso-envio` ganha tabindex="-1" já no render() (em
      // tela.js) para sempre poder receber foco por script.
      function focarAviso() {
        var caixa = document.getElementById('aviso-envio');
        if (caixa) caixa.focus();
      }

      function botaoRecarregar() {
        return el('button', { type: 'button', texto: 'Recarregar a página', onclick: function () { salvarAgora(); window.location.reload(); } });
      }

      function botaoTentarDeNovo(aoClicar) {
        return el('button', { type: 'button', texto: 'Tentar de novo', onclick: aoClicar });
      }

      function linkSuporte() {
        return el('a', { classe: 'link-toque', href: 'https://www.rodrigorosar.com.br/suporte', target: '_blank', rel: 'noopener noreferrer', texto: 'Fale com o suporte' });
      }

      function concluir() {
        estado.concluido = true;
        pararTemporizador();
        N.apagarRascunho(armazem);
      }

      var CHAVES_NIVEL_1 = ['email', 'nome', 'whatsapp', 'instagram', 'consentimento'];
      var SUBCHAVES_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'pais', 'enderecoCompleto'];

      function todasPerguntas() {
        return estado.formulario.etapas.reduce(function (t, e) { return t.concat(e.perguntas); }, []);
      }

      /**
       * M-1: uma chave de erro do servidor "tem campo na tela" quando existe um
       * `#in-<chave>` (ou pergunta reconhecida) correspondente — ao contrário de
       * `document.getElementById`, isso não depende da etapa atualmente
       * renderizada. `corpo`, `endereco` sozinho (sem subcampo) ou uma
       * `respostas.<id>` de pergunta que não existe mais no cardápio não têm
       * campo: precisam aparecer no aviso geral, nunca tentar navegar para lugar
       * nenhum.
       */
      function campoExiste(chave) {
        if (CHAVES_NIVEL_1.indexOf(chave) >= 0) return true;
        if (chave.indexOf('endereco.') === 0) return SUBCHAVES_ENDERECO.indexOf(chave.slice('endereco.'.length)) >= 0;
        if (chave.indexOf('respostas.') === 0) {
          var id = chave.slice('respostas.'.length);
          return todasPerguntas().some(function (p) { return p.id === id; });
        }
        return false;
      }

      function primeiraEtapaComErro(dados, formulario, atual) {
        for (var n = 1; n <= 4; n++) {
          if (Object.keys(N.errosDaEtapa(n, dados, formulario)).length) return n;
        }
        return atual;
      }

      function tratarErros400(dados) {
        var comCampo = {};
        var semCampo = [];
        Object.keys(dados.campos).forEach(function (chave) {
          if (campoExiste(chave)) comCampo[chave] = dados.campos[chave];
          else semCampo.push(dados.campos[chave]);
        });
        var teveCampo = Object.keys(comCampo).length > 0;
        if (teveCampo) irParaErros(comCampo);
        if (semCampo.length) {
          // M-1: mensagem(ns) sem campo próprio na tela + link de suporte, sem
          // tentar navegar para etapa nenhuma por causa delas.
          avisoEnvio(semCampo.join(' '), [' ', linkSuporte()]);
          if (!teveCampo) focarAviso();
        } else {
          avisoEnvio(dados.erro || 'Revise os campos destacados.', []);
        }
      }

      /** I-1: 409 não pede mais para recarregar a página — busca o cardápio
       * atualizado (sem cache), mescla o que ainda é válido e deixa a pessoa
       * revisar e reenviar, tudo sem perder o que ela já preencheu. Só cai no
       * aviso antigo (com "Recarregar a página") se essa nova busca falhar. */
      function tratar409(dados) {
        // Fix round 2 (Important): devolve a promise — enviar() precisa saber
        // quando essa recuperação (sucesso OU fallback) realmente terminou,
        // senão o botão reabilita e o .finally() zera "enviando" ainda com a
        // busca do formulário em voo, abrindo brecha para um segundo envio com
        // estado.formulario desatualizado enquanto o primeiro 409 ainda está
        // sendo tratado.
        return buscarFormulario({ semCache: true })
          .then(function (novo) {
            estado.formulario = novo;
            estado.dados = N.mesclarDados(N.estadoInicial(novo), estado.dados);
            estado.etapa = primeiraEtapaComErro(estado.dados, novo, estado.etapa);
            salvarAgora();
            render();
            var erros = N.errosDaEtapa(estado.etapa, estado.dados, novo);
            if (Object.keys(erros).length) mostrarErros(erros);
            avisoEnvio('O formulário foi atualizado. Confira as respostas e envie de novo.', []);
            focarAviso();
          })
          .catch(function () {
            avisoEnvio((dados && dados.erro) || 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.', [botaoRecarregar()]);
            focarAviso();
          });
      }

      function tratarResposta(status, dados) {
        if (status === 201 && dados && dados.ok && /^https:\/\//.test(dados.centralUrl || '')) {
          concluir();
          gtm('credenciamento_enviado');
          renderSucesso(dados);
          return;
        }
        if (status === 400 && dados && dados.campos) {
          tratarErros400(dados);
          return;
        }
        if (status === 409) {
          return tratar409(dados); // propaga a promise para enviar() (fix round 2)
        }
        if (status === 410) {
          concluir();
          renderEncerrado();
          return;
        }
        // 429, 5xx, corpo não-JSON (dados===null) e qualquer outra resposta
        // inesperada caem aqui — sempre com o texto do servidor quando existe.
        avisoEnvio((dados && dados.erro) || N.MENSAGENS.falhaEnvio, []);
        focarAviso();
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
        var oculto = document.getElementById('cred_campo_extra');
        var corpo = N.montarEnvio(estado.formulario, estado.dados, estado.canal, estado.inicio || Date.now(), Date.now(), oculto ? oculto.value : '');
        buscar(N.apiBase(window.location) + '/api/public/credenciamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        })
          .then(function (res) {
            return res.json().catch(function () { return null; }).then(function (dados) { return tratarResposta(res.status, dados); });
          })
          .catch(function () {
            // M-4: falha de rede também ganha um jeito de tentar de novo direto
            // no aviso, além do botão "Confirmar" (que o finally já reabilita).
            avisoEnvio(N.MENSAGENS.falhaEnvio, [botaoTentarDeNovo(enviar)]);
            focarAviso();
          })
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
        // I-3: mesma checagem de esquema do centralUrl — nunca confiar cegamente
        // numa URL vinda do servidor (poderia ser "javascript:" ou outro esquema perigoso).
        if (/^https:\/\//.test(estado.formulario.grupoUrl || '')) {
          filhos.push(el('a', {
            classe: 'botao botao--secundario botao--largo', href: estado.formulario.grupoUrl,
            target: '_blank', rel: 'noopener noreferrer', texto: 'Entrar no grupo dos participantes',
          }));
        }
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
          el('p', {}, ['Dúvidas? Fale com o suporte: ', el('a', { classe: 'link-toque', href: 'https://www.rodrigorosar.com.br/suporte', target: '_blank', rel: 'noopener noreferrer', texto: 'rodrigorosar.com.br/suporte' })]),
        ]));
        document.getElementById('titulo-encerrado').focus(); // M-3: tanto ao carregar já encerrado quanto após 410 no envio
      }

      return {
        enviar: enviar,
        renderEncerrado: renderEncerrado,
      };
    },
  });
})();
