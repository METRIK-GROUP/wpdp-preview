// credenciamento/protecao.js
// Verificação anti-robô OPCIONAL (Cloudflare Turnstile). Só liga quando o GET
// do formulário traz protecao.turnstileSiteKey como texto não vazio; sem a
// chave, nada é carregado e o envio não muda. Nunca bloqueia o envio: sem
// token (script bloqueado, navegador sem suporte, erro, 5 s sem desafio
// interativo, ou 120 s com o desafio sem resposta), o envio segue sem ele e o
// servidor decide. Nada pessoal vai para o Turnstile, e o token só fica em
// memória (nunca no rascunho, no dataLayer ou no console).
// Fábrica congelada, como envio.js: tela.js cria e entrega para envio.js.
(function () {
  'use strict';

  var SCRIPT_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var ESPERA_TOKEN_MS = 5000; // sem desafio interativo
  var ESPERA_INTERATIVA_MS = 120000; // R-b: teto desde o clique quando o desafio pede a pessoa
  var LARGURA_MIN_FLEXIVEL = 300; // R-a: "flexible" tem mínimo de 300 px (Cloudflare); abaixo disso, "compact"
  var DICA_INTERATIVA = 'Falta só uma confirmação: marque a caixa acima para enviar.';

  window.CredProtecao = Object.freeze({
    /**
     * @returns {{ configurar: Function, ativa: Function, montar: Function, token: Function, reiniciar: Function }}
     */
    criar: function () {
      var chave = null;
      var script = 'nenhum'; // 'nenhum' | 'carregando' | 'pronto' | 'falhou' (inclui navegador sem suporte)
      var caixa = null;
      var dica = null;
      var widget = null;
      var tokenAtual = null;
      var esperas = [];
      // R-b: `passouInterativo` liga quando o desafio atual entra em modo
      // interativo e só desliga com um desafio novo (widget trocado,
      // reiniciado ou com erro) — quem acabou de resolver (já saiu do modo
      // interativo, o token ainda vem) não cai no corte de 5 s.
      // `emInteracao` só decide se a dica aparece.
      var passouInterativo = false;
      var emInteracao = false;
      // Widget que já falhou (render lançou erro ou error-callback) antes do
      // clique: o envio segue sem token na hora, sem os 5 s de espera.
      var desafioFalhou = false;

      /** Entrega o token (ou null) a todo envio que está esperando por ele. */
      function avisar(token) {
        var lista = esperas;
        esperas = [];
        lista.forEach(function (fim) { fim(token); });
      }

      function api() {
        var t = window.turnstile;
        return t && typeof t.render === 'function' ? t : null;
      }

      // Falha do widget nunca pode quebrar a página nem o envio: o combinado é
      // seguir sem token (o servidor decide). Por isso o erro é descartado de
      // propósito aqui — sem console, sem aviso na tela.
      function tentar(acao) {
        try {
          return acao();
        } catch (e) {
          return null;
        }
      }

      /** Dica ao lado do widget: só com um envio esperando e o desafio pedindo a pessoa. */
      function atualizarDica() {
        if (dica) dica.textContent = esperas.length && emInteracao ? DICA_INTERATIVA : '';
      }

      /** Widget novo, reiniciado, com token vencido ou com erro: token e modo interativo zerados. */
      function novoDesafio() {
        tokenAtual = null;
        passouInterativo = false;
        emInteracao = false;
        desafioFalhou = false;
        atualizarDica();
      }

      function remover() {
        var t = api();
        if (widget !== null && t) tentar(function () { t.remove(widget); });
        widget = null;
        novoDesafio();
      }

      /** Script que não carregou ou navegador sem suporte: segue sem token, na hora. */
      function semTurnstile() {
        script = 'falhou';
        tokenAtual = null;
        avisar(null);
      }

      function tamanho() {
        var largura = caixa ? caixa.clientWidth : 0;
        return largura > 0 && largura < LARGURA_MIN_FLEXIVEL ? 'compact' : 'flexible';
      }

      function opcoes() {
        return {
          sitekey: chave,
          callback: function (token) {
            tokenAtual = token;
            emInteracao = false;
            desafioFalhou = false;
            avisar(token);
          },
          'expired-callback': novoDesafio, // token vencido: o próximo desafio começa do zero (item 3)
          'error-callback': function () {
            novoDesafio();
            desafioFalhou = true;
            avisar(null);
            return true; // erro tratado: o Turnstile não lança exceção nem escreve no console
          },
          'before-interactive-callback': function () {
            desafioFalhou = false;
            passouInterativo = true;
            emInteracao = true;
            atualizarDica();
          },
          'after-interactive-callback': function () {
            emInteracao = false;
            atualizarDica();
          },
          'unsupported-callback': semTurnstile,
          appearance: 'interaction-only',
          size: tamanho(),
          language: 'pt-br',
          'refresh-expired': 'auto',
          'response-field': false,
        };
      }

      function desenhar() {
        var t = api();
        if (!t || !caixa || !caixa.isConnected) return;
        widget = tentar(function () { return t.render(caixa, opcoes()); }) || null;
        if (widget === null) {
          desafioFalhou = true;
          avisar(null);
        }
      }

      function carregar() {
        script = 'carregando';
        var s = document.createElement('script');
        s.src = SCRIPT_TURNSTILE;
        s.async = true;
        s.onload = function () {
          if (!api()) {
            semTurnstile();
            return;
          }
          script = 'pronto';
          desenhar();
        };
        s.onerror = semTurnstile; // bloqueado por extensão, rede: segue sem token
        document.head.appendChild(s);
      }

      /** Aviso educado (leitores de tela) logo abaixo do widget; só texto. */
      function criarDica(elemento) {
        var p = document.createElement('p');
        p.id = 'verificacao-dica';
        p.className = 'ajuda';
        p.setAttribute('aria-live', 'polite');
        elemento.parentNode.insertBefore(p, elemento.nextSibling);
        return p;
      }

      /**
       * Promessa do token para o envio: na hora, se já existe. Senão espera:
       * sem desafio interativo, até 5 s; se o desafio pediu a pessoa (antes ou
       * durante a espera), até o token chegar, com teto de 120 s desde o
       * clique (R-b). Erro (inclusive antes do clique), sem suporte ou script
       * que falhou: null na hora.
       */
      function token() {
        if (chave === null || script === 'falhou' || desafioFalhou) return Promise.resolve(null);
        if (tokenAtual) return Promise.resolve(tokenAtual);
        return new Promise(function (resolver) {
          var curto = setTimeout(function () { if (!passouInterativo) sair(null); }, ESPERA_TOKEN_MS);
          var teto = setTimeout(function () { sair(null); }, ESPERA_INTERATIVA_MS);
          function sair(valor) {
            clearTimeout(curto);
            clearTimeout(teto);
            esperas = esperas.filter(function (fim) { return fim !== sair; });
            atualizarDica();
            resolver(valor);
          }
          esperas.push(sair);
          atualizarDica();
        });
      }

      return {
        /** Lê protecao.turnstileSiteKey do cardápio; sem chave (ou vazia), fica desligada. */
        configurar: function (formulario) {
          var p = formulario && formulario.protecao;
          var nova = p && typeof p.turnstileSiteKey === 'string' && p.turnstileSiteKey.trim() ? p.turnstileSiteKey.trim() : null;
          if (nova !== chave) remover();
          chave = nova;
        },
        ativa: function () {
          return chave !== null;
        },
        /** Etapa 4 desenhada: carrega o script (uma vez só) e põe um widget novo em `elemento`. */
        montar: function (elemento) {
          if (chave === null) return;
          remover(); // o widget anterior ficou na etapa 4 que já saiu da tela
          caixa = elemento;
          dica = criarDica(elemento);
          if (script === 'pronto') desenhar();
          else if (script === 'nenhum') carregar();
        },
        token: token,
        /** Depois de QUALQUER tentativa de envio: o token é de uso único, o widget gera outro. */
        reiniciar: function () {
          var t = api();
          novoDesafio();
          if (widget !== null && t) tentar(function () { t.reset(widget); });
        },
      };
    },
  });
})();
