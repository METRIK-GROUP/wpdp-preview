// credenciamento/protecao.js
// Verificação anti-robô OPCIONAL (Cloudflare Turnstile). Só liga quando o GET
// do formulário traz protecao.turnstileSiteKey como texto não vazio; sem a
// chave, nada é carregado e o envio não muda. Nunca bloqueia o envio: sem
// token (script bloqueado, erro, desafio sem resposta em 5 s), o envio segue
// sem ele e o servidor decide. Nada pessoal vai para o Turnstile, e o token só
// fica em memória (nunca no rascunho, no dataLayer ou no console).
// Fábrica congelada, como envio.js: tela.js cria e entrega para envio.js.
(function () {
  'use strict';

  var SCRIPT_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var ESPERA_TOKEN_MS = 5000;

  window.CredProtecao = Object.freeze({
    /**
     * @returns {{ configurar: Function, ativa: Function, montar: Function, token: Function, reiniciar: Function }}
     */
    criar: function () {
      var chave = null;
      var script = 'nenhum'; // 'nenhum' | 'carregando' | 'pronto' | 'falhou'
      var caixa = null;
      var widget = null;
      var tokenAtual = null;
      var esperas = [];

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

      function remover() {
        var t = api();
        if (widget !== null && t) tentar(function () { t.remove(widget); });
        widget = null;
        tokenAtual = null;
      }

      function opcoes() {
        return {
          sitekey: chave,
          callback: function (token) {
            tokenAtual = token;
            avisar(token);
          },
          'expired-callback': function () { tokenAtual = null; },
          'error-callback': function () {
            tokenAtual = null;
            avisar(null);
            return true; // erro tratado: o Turnstile não lança exceção nem escreve no console
          },
          appearance: 'interaction-only',
          size: 'flexible',
          language: 'pt-br',
          'refresh-expired': 'auto',
          'response-field': false,
        };
      }

      function desenhar() {
        var t = api();
        if (!t || !caixa || !caixa.isConnected) return;
        widget = tentar(function () { return t.render(caixa, opcoes()); }) || null;
        if (widget === null) avisar(null);
      }

      function falhar() {
        script = 'falhou';
        avisar(null);
      }

      function carregar() {
        script = 'carregando';
        var s = document.createElement('script');
        s.src = SCRIPT_TURNSTILE;
        s.async = true;
        s.onload = function () {
          if (!api()) {
            falhar();
            return;
          }
          script = 'pronto';
          desenhar();
        };
        s.onerror = falhar; // bloqueado por extensão, rede: segue sem token
        document.head.appendChild(s);
      }

      /** Promessa do token para o envio: na hora se já existe; senão espera até 5 s; ou null. */
      function token() {
        if (chave === null || script === 'falhou') return Promise.resolve(null);
        if (tokenAtual) return Promise.resolve(tokenAtual);
        return new Promise(function (resolver) {
          var relogio = setTimeout(function () { sair(null); }, ESPERA_TOKEN_MS);
          function sair(valor) {
            clearTimeout(relogio);
            esperas = esperas.filter(function (fim) { return fim !== sair; });
            resolver(valor);
          }
          esperas.push(sair);
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
          if (script === 'pronto') desenhar();
          else if (script === 'nenhum') carregar();
        },
        token: token,
        /** Depois de QUALQUER tentativa de envio: o token é de uso único, o widget gera outro. */
        reiniciar: function () {
          var t = api();
          tokenAtual = null;
          if (widget !== null && t) tentar(function () { t.reset(widget); });
        },
      };
    },
  });
})();
