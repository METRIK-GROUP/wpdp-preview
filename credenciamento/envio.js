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
     * @param {object} ctx.protecao - verificação anti-robô opcional (window.CredProtecao.criar())
     * @returns {{ enviar: Function, renderEncerrado: Function }}
     */
    criar: function (ctx) {
      var estado = ctx.estado;
      var N = ctx.N;
      var protecao = ctx.protecao;
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
      // M-2: o POST espera até 35 s (em pico o servidor pode demorar: banco,
      // e-mail); a busca do formulário (GET, inclusive a sem cache do 409)
      // tem prazo próprio de 45 s por tentativa (LIMITE_CARGA_MS, em carga.js).
      var LIMITE_ENVIO_MS = 35000;

      // ---------------------------------------------------------------- envio
      function marcarBotao(ocupado) {
        var botao = document.getElementById('botao-principal');
        if (!botao) return;
        botao.disabled = ocupado;
        botao.textContent = ocupado ? 'Enviando…' : estado.etapa < 4 ? 'Próximo' : 'Confirmar meu credenciamento';
        // R-b: com a espera do desafio anti-robô (até 120 s), "Voltar" também
        // espera — senão o envio sairia depois, com a pessoa em outra etapa.
        var voltar = botao.parentNode ? botao.parentNode.querySelector('.botao--secundario') : null;
        if (voltar) voltar.disabled = ocupado;
      }

      // Ajustes finais, item 1: enquanto envia (inclusive na espera de até
      // 120 s do anti-robô), campos e "Começar do zero" ficam travados (inert)
      // — nada muda o que vai no corpo. Ficam de fora só o widget do
      // Turnstile e sua dica, os avisos e a linha de botões.
      var FORA_DA_TRAVA = ['status', 'aviso-envio', 'verificacao', 'verificacao-dica'];

      function travarFormulario(travar) {
        var form = app.querySelector('form');
        if (form) {
          Array.prototype.forEach.call(form.children, function (filho) {
            if (FORA_DA_TRAVA.indexOf(filho.id) >= 0 || filho.classList.contains('acoes')) return;
            filho.toggleAttribute('inert', travar);
          });
        }
        var zero = document.getElementById('comecar-do-zero');
        if (zero) zero.disabled = travar;
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
      // Chaves do servidor sem campo próprio na tela: vão para o aviso geral (M-1).
      var CHAVES_SEM_CAMPO = ['corpo', 'endereco'];

      /** C3: texto do servidor só é usado se for texto — e entra sempre como texto (nunca HTML). */
      function textoServidor(valor, padrao) {
        return typeof valor === 'string' && valor ? valor : padrao;
      }

      function todasPerguntas() {
        return estado.formulario.etapas.reduce(function (t, e) { return t.concat(e.perguntas); }, []);
      }

      /**
       * M-1: uma chave de erro do servidor "tem campo na tela" quando existe um
       * `#in-<chave>` (ou pergunta reconhecida) correspondente — ao contrário de
       * `document.getElementById`, isso não depende da etapa atualmente
       * renderizada. Sem campo: `corpo` e `endereco` sozinho (CHAVES_SEM_CAMPO)
       * vão para o aviso geral; qualquer outra chave — como `respostas.<id>` de
       * pergunta que não existe no cardápio — é ignorada (C3, ver tratarErros400).
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

      function tratarErros400(dados) {
        var comCampo = {};
        var semCampo = [];
        Object.keys(dados.campos).forEach(function (chave) {
          var mensagem = dados.campos[chave];
          if (typeof mensagem !== 'string') return;
          if (campoExiste(chave)) comCampo[chave] = mensagem;
          else if (CHAVES_SEM_CAMPO.indexOf(chave) >= 0) semCampo.push(mensagem);
          // C3: qualquer outra chave é ignorada — o servidor devolve até 5
          // chaves escolhidas por quem mandou o pedido.
        });
        var teveCampo = Object.keys(comCampo).length > 0;
        if (teveCampo) irParaErros(comCampo);
        if (teveCampo && !semCampo.length) {
          avisoEnvio(textoServidor(dados.erro, 'Revise os campos destacados.'), []);
          return;
        }
        // M-1/C3: mensagem sem campo próprio na tela (ou nenhuma chave
        // conhecida) vai para o aviso geral com o suporte, sem navegar.
        avisoEnvio(semCampo.length ? semCampo.join(' ') : textoServidor(dados.erro, N.MENSAGENS.falhaEnvio), [' ', linkSuporte()]);
        if (!teveCampo) focarAviso();
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
        // I-2 / M-11 / N-1: nos DOIS caminhos o rascunho ganha o marcador
        // `migrar: <edição>` — assim a próxima carga mescla (em vez de
        // descartar) um rascunho de versão diferente da que vier do servidor,
        // desde que da MESMA edição: a nova (depois do "Recarregar a página")
        // ou a antiga (CDN ainda com cache depois de uma recuperação certa).
        return buscarFormulario({ semCache: true })
          .then(function (novo) {
            // N-1: respostas nunca passam para outra edição — cai no aviso de
            // recarregar, e a recarga descarta o rascunho da edição antiga.
            if (novo.edicao !== estado.formulario.edicao) throw new Error('outra edição');
            var outraVersao = novo.versao !== estado.formulario.versao;
            estado.formulario = novo;
            protecao.configurar(novo); // C1: a chave do Turnstile vem com o cardápio
            // O-1: outra versão → autorização desmarcada (o texto pode ter mudado).
            estado.dados = outraVersao ? N.migrarDados(novo, estado.dados) : N.mesclarDados(N.estadoInicial(novo), estado.dados);
            estado.etapa = N.primeiraEtapaComErro(estado.dados, novo, estado.etapa);
            estado.migrar = true;
            salvarAgora();
            render();
            var erros = N.errosDaEtapa(estado.etapa, estado.dados, novo);
            if (Object.keys(erros).length) mostrarErros(erros);
            avisoEnvio('O formulário foi atualizado. Confira as respostas e envie de novo.', []);
            focarAviso();
          })
          .catch(function () {
            estado.migrar = true;
            salvarAgora(); // já marcado: vale também para quem recarrega pelo navegador ou volta outro dia
            avisoEnvio(textoServidor(dados && dados.erro, 'O formulário foi atualizado. Recarregue a página — suas respostas ficam salvas.'), [botaoRecarregar()]);
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
        avisoEnvio(textoServidor(dados && dados.erro, N.MENSAGENS.falhaEnvio), []);
        focarAviso();
      }

      /** Erros da primeira etapa (1 a 4) que tiver algum; null se tudo vale. */
      function errosPendentes() {
        for (var n = 1; n <= 4; n++) {
          var erros = N.errosDaEtapa(n, estado.dados, estado.formulario);
          if (Object.keys(erros).length) return erros;
        }
        return null;
      }

      function enviar() {
        if (estado.enviando) return;
        var pendentes = errosPendentes();
        if (pendentes) {
          irParaErros(pendentes);
          return;
        }
        estado.enviando = true;
        marcarBotao(true);
        travarFormulario(true);
        var caixa = document.getElementById('aviso-envio');
        if (caixa) limpar(caixa);
        // C1: com a verificação ligada e ainda sem token, espera até 5 s por
        // ele (o botão segue em "Enviando…"); depois envia COM ou SEM token.
        return protecao.token()
          .then(postar)
          .catch(function () {
            // M-4: falha de rede também ganha um jeito de tentar de novo direto
            // no aviso, além do botão "Confirmar" (que o finally já reabilita).
            avisoEnvio(N.MENSAGENS.falhaEnvio, [botaoTentarDeNovo(enviar)]);
            focarAviso();
          })
          .finally(function () {
            estado.enviando = false;
            travarFormulario(false);
            marcarBotao(false);
          });
      }

      /**
       * Depois de uma tentativa (ou de desistir dela): destrava os campos ANTES
       * de mostrar o resultado (o foco de erro precisa alcançar o campo) e
       * troca o token do Turnstile — ele é de uso único.
       */
      function depoisDaTentativa() {
        travarFormulario(false);
        protecao.reiniciar();
      }

      /** O POST em si; `token` do Turnstile vai só no corpo (nunca no rascunho). */
      function postar(token) {
        // Item 1: valida de novo logo antes do POST — o que ficou inválido na
        // espera não é enviado (o token não é gasto) e a página mostra o erro.
        var pendentes = errosPendentes();
        if (pendentes) {
          depoisDaTentativa();
          irParaErros(pendentes);
          return;
        }
        var oculto = document.getElementById('cred_campo_extra');
        var corpo = N.montarEnvio(estado.formulario, estado.dados, estado.canal, estado.inicio || Date.now(), Date.now(), oculto ? oculto.value : '');
        if (token) corpo = Object.assign({}, corpo, { turnstileToken: token });
        var pedido = buscar(N.apiBase(window.location) + '/api/public/credenciamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        }, LIMITE_ENVIO_MS);
        // C1: depois de QUALQUER tentativa (resposta, erro, rede, prazo): campos
        // destravados e token trocado, antes de tratar a resposta.
        pedido.then(depoisDaTentativa, depoisDaTentativa);
        return pedido.then(function (res) { return tratarResposta(res.status, res.dados); });
      }

      // ------------------------------------------------------- telas finais
      // M-1: o código do crachá (depois de "#acesso=") nunca vai para um href
      // nem para o HTML da página — o GTM/GA4 lê o href de links clicados
      // (cliques de saída, "Just Links"). O link aponta para a Central sem o
      // código; o clique normal (sem tecla modificadora) navega com ele.
      function semCodigo(url) {
        return url.split('#')[0];
      }

      function linkCentral(url) {
        return el('a', {
          classe: 'botao botao--primario botao--largo', href: semCodigo(url), texto: 'Acessar a Central do Workshop',
          onclick: function (ev) {
            if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return; // nova aba/janela: padrão do navegador
            ev.preventDefault();
            window.location.assign(url);
          },
        });
      }

      function mostrarLinkParaCopiar(botao, url) {
        var campo = el('input', { type: 'text', readonly: true, 'aria-label': 'Seu link pessoal' });
        campo.value = url; // propriedade, não atributo: o código não fica no HTML da página (M-1)
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

      /** Item 6: sem primeiro nome válido, o título não fica "confirmado, !". */
      function tituloSucesso(nome) {
        return nome ? '✅ Credenciamento confirmado, ' + nome + '!' : '✅ Credenciamento confirmado!';
      }

      function renderSucesso(r) {
        limpar(app);
        var filhos = [
          el('h2', { id: 'titulo-sucesso', tabindex: '-1', texto: tituloSucesso(textoServidor(r.primeiroNome, '')) }),
          el('p', { texto: 'Seu acesso à Central do Workshop está pronto.' }),
          linkCentral(r.centralUrl),
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
